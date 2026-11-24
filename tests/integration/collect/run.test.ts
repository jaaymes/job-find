import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobSources, jobs, sourceRuns, sourceState } from "@/lib/server/db/schema";
import { acquireLock, releaseLock } from "@/lib/server/collect/lock";
import { runCollection } from "@/lib/server/collect/run";
import { fetchBoardsPooled } from "@/lib/server/sources/boards";
import * as enrich from "@/lib/server/jobs/enrich-job";
import * as expire from "@/lib/server/jobs/expire";
import * as upsert from "@/lib/server/jobs/upsert";
import * as http from "@/lib/server/sources/http";
import { SANITIZER_VERSION } from "@/lib/server/sanitize";
import type { Connector, NormalizedJob } from "@/lib/server/sources/types";
import type { SourceId } from "@/lib/shared/types/job";
import { insertJobRaw, resetDb, testDb } from "../setup";
import { addDays, T0 } from "../jobs/helpers";

type Raw = { id: string; title?: string; publishedAt?: Date | null };

function norm(raw: unknown): NormalizedJob | null {
  const r = raw as Raw;
  if (r.title === "skip") return null;
  return {
    externalId: r.id,
    url: `https://boards.example.com/acme/${r.id}`,
    title: r.title ?? `Desenvolvedor React ${r.id}`,
    company: `Empresa ${r.id}`,
    companyLogoUrl: null,
    descriptionHtml: `<p>Vaga de React ${r.id}</p>`,
    descriptionFormat: "html",
    country: "BR",
    city: null,
    locationText: "Brasil",
    eligibleRegions: [],
    workModeHint: "remote",
    seniorityHint: null,
    tags: ["react"],
    salary: null,
    publishedAt: r.publishedAt === undefined ? addDays(T0, -1) : r.publishedAt,
  };
}

function conn(id: SourceId, over: Partial<Connector> & { items?: Raw[] } = {}): Connector {
  const { items = [], ...rest } = over;
  return {
    id,
    brazilian: true,
    fullSnapshot: true,
    minIntervalMinutes: 0,
    allowedHosts: ["boards.example.com"],
    attribution: { label: id, url: "https://example.com", dofollow: false },
    async *fetch() {
      for (const i of items) yield i;
    },
    normalize: norm,
    ...rest,
  };
}

const range = (n: number, prefix = "j"): Raw[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

const throwing = (id: SourceId) =>
  conn(id, {
    async *fetch() {
      throw new Error("falha de rede");
    },
  });

async function countJobs(db: Awaited<ReturnType<typeof testDb>>) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(jobs);
  return r.n;
}
async function state(db: Awaited<ReturnType<typeof testDb>>, source: SourceId) {
  const [r] = await db.select().from(sourceState).where(eq(sourceState.source, source));
  return r;
}

describe("runCollection", () => {
  beforeEach(resetDb);

  it("isola falhas por fonte, grava estado e invalida o cache só com mudança", async () => {
    const db = await testDb();
    const invalidate = vi.fn().mockResolvedValue(undefined);
    const res = await runCollection({
      db,
      sources: ["greenhouse", "ashby"],
      now: T0,
      connectors: { greenhouse: conn("greenhouse", { items: range(5) }), ashby: throwing("ashby") },
      invalidate,
    });
    expect(res.map((r) => r.source)).toEqual(["greenhouse", "ashby"]);
    expect(res[0]).toMatchObject({ status: "ok", fetched: 5, inserted: 5, updated: 0 });
    expect(res[1].status).toBe("error");
    expect(res[1].error).toContain("falha de rede");
    expect(await countJobs(db)).toBe(5);
    expect((await state(db, "ashby")).consecutiveFailures).toBe(1);
    const g = await state(db, "greenhouse");
    expect(g).toMatchObject({ consecutiveFailures: 0, lastFetchedCount: 5, lockedUntil: null });
    expect(g.lastSuccessAt).toEqual(T0);
    expect(invalidate).toHaveBeenCalledWith("jobs");

    const runs = await db.select().from(sourceRuns).orderBy(sourceRuns.id);
    expect(runs.map((r) => [r.source, r.status])).toEqual([
      ["greenhouse", "ok"],
      ["ashby", "error"],
    ]);
    expect(runs[0]).toMatchObject({ fetchedCount: 5, newCount: 5, updatedCount: 0 });
    expect(runs[0].finishedAt).not.toBeNull();

    const inv2 = vi.fn().mockResolvedValue(undefined);
    const again = await runCollection({
      db,
      sources: ["greenhouse"],
      now: T0,
      connectors: { greenhouse: conn("greenhouse", { items: range(5) }) },
      invalidate: inv2,
    });
    expect(again[0]).toMatchObject({ status: "ok", inserted: 0, updated: 0 });
    expect(inv2).not.toHaveBeenCalledWith("jobs");
    expect(inv2).toHaveBeenCalledWith("sources-status");
  });

  it("fonte sem conector vira erro claro", async () => {
    const db = await testDb();
    const [r] = await runCollection({ db, sources: ["lever"], now: T0, connectors: {} });
    expect(r.status).toBe("error");
    expect(r.error).toContain("conector");
  });

  it("fonte travada é pulada e o lock é liberado ao fim", async () => {
    const db = await testDb();
    expect(await acquireLock(db, "greenhouse", 60_000)).toBe(true);
    expect(await acquireLock(db, "greenhouse", 60_000)).toBe(false);
    const [r] = await runCollection({
      db,
      sources: ["greenhouse"],
      now: T0,
      connectors: { greenhouse: conn("greenhouse", { items: range(1) }) },
    });
    expect(r.status).toBe("skipped");
    expect(await countJobs(db)).toBe(0);
    await releaseLock(db, "greenhouse");
    const [ok] = await runCollection({
      db,
      sources: ["greenhouse"],
      now: T0,
      connectors: { greenhouse: conn("greenhouse", { items: range(1) }) },
    });
    expect(ok.status).toBe("ok");
    expect((await state(db, "greenhouse")).lockedUntil).toBeNull();
  });

  it("respeita minIntervalMinutes", async () => {
    const db = await testDb();
    const c = conn("greenhouse", { items: range(2), minIntervalMinutes: 60 });
    const first = await runCollection({ db, sources: ["greenhouse"], now: T0, connectors: { greenhouse: c } });
    expect(first[0].status).toBe("ok");
    const tooSoon = new Date(T0.getTime() + 10 * 60_000);
    const second = await runCollection({ db, sources: ["greenhouse"], now: tooSoon, connectors: { greenhouse: c } });
    expect(second[0].status).toBe("skipped");
    const later = new Date(T0.getTime() + 61 * 60_000);
    const third = await runCollection({ db, sources: ["greenhouse"], now: later, connectors: { greenhouse: c } });
    expect(third[0].status).toBe("ok");
  });

  it("cursor só é gravado quando a coleta termina ok", async () => {
    const db = await testDb();
    const withCursor = (fail: boolean) =>
      conn("himalayas", {
        fullSnapshot: false,
        async *fetch(ctx) {
          ctx.setCursor(`novo-${ctx.cursor ?? "zero"}`);
          yield { id: "h1" };
          if (fail) throw new Error("quebrou");
        },
      });
    await runCollection({ db, sources: ["himalayas"], now: T0, connectors: { himalayas: withCursor(false) } });
    expect((await state(db, "himalayas")).cursor).toBe("novo-zero");
    const [r] = await runCollection({ db, sources: ["himalayas"], now: T0, connectors: { himalayas: withCursor(true) } });
    expect(r.status).toBe("error");
    const s = await state(db, "himalayas");
    expect(s.cursor).toBe("novo-zero");
    expect(s.consecutiveFailures).toBe(1);
  });

  it("markMissedRuns só roda para fullSnapshot ok, com a contagem anterior", async () => {
    const db = await testDb();
    const spy = vi.spyOn(expire, "markMissedRuns");
    try {
      await runCollection({
        db,
        sources: ["greenhouse", "himalayas"],
        now: T0,
        connectors: {
          greenhouse: conn("greenhouse", { items: range(3) }),
          himalayas: conn("himalayas", { fullSnapshot: false, items: range(3, "h") }),
        },
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(expect.anything(), "greenhouse", T0, 3, null);
      await runCollection({
        db,
        sources: ["greenhouse"],
        now: new Date(T0.getTime() + 3_600_000),
        connectors: { greenhouse: conn("greenhouse", { items: range(2) }) },
      });
      expect(spy).toHaveBeenLastCalledWith(expect.anything(), "greenhouse", expect.any(Date), 2, 3);
      spy.mockClear();
      await runCollection({ db, sources: ["greenhouse"], now: T0, connectors: { greenhouse: throwing("greenhouse") } });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  describe("expiração por escopo de boards", () => {
    async function missed(db: Awaited<ReturnType<typeof testDb>>) {
      const rows = await db
        .select({ externalId: jobSources.externalId, missedRuns: jobSources.missedRuns })
        .from(jobSources);
      return Object.fromEntries(rows.map((r) => [r.externalId, r.missedRuns]));
    }

    async function seedAndRescope(seed: string[], read: string[], scope: string[]) {
      const db = await testDb();
      await runCollection({
        db,
        sources: ["greenhouse"],
        now: T0,
        connectors: { greenhouse: conn("greenhouse", { items: seed.map((id) => ({ id })) }) },
      });
      const scoped = conn("greenhouse", {
        async *fetch(ctx) {
          for (const id of read) yield { id };
          ctx.reportScope(scope);
        },
      });
      await runCollection({
        db,
        sources: ["greenhouse"],
        now: new Date(T0.getTime() + 3_600_000),
        connectors: { greenhouse: scoped },
      });
      return missed(db);
    }

    it("fonte com escopo marca coleta perdida só nos boards lidos", async () => {
      const m = await seedAndRescope(["a:1", "b:1"], ["a:2"], ["a:"]);
      expect(m["a:1"]).toBe(1);
      expect(m["b:1"]).toBe(0);
      expect(m["a:2"]).toBe(0);
    });

    it("prefixo com _ não casa outro board", async () => {
      const m = await seedAndRescope(["wild_x:1", "wildAx:1"], ["wild_x:2"], ["wild_x:"]);
      expect(m["wild_x:1"]).toBe(1);
      expect(m["wildAx:1"]).toBe(0);
    });

    it.each([
      ["%", "pct%x:", "pctAAx:"],
      ["\\", "bs\\x:", "bsx:"],
    ])("prefixo com %s literal não casa outro board", async (_nome, inside, outside) => {
      const m = await seedAndRescope([`${inside}1`, `${outside}1`], [`${inside}2`], [inside]);
      expect(m[`${inside}1`]).toBe(1);
      expect(m[`${outside}1`]).toBe(0);
    });

    it("com escopo, falha parcial não impede a coleta perdida nos boards lidos", async () => {
      const db = await testDb();
      await runCollection({
        db,
        sources: ["greenhouse"],
        now: T0,
        connectors: { greenhouse: conn("greenhouse", { items: [{ id: "a:1" }, { id: "b:1" }] }) },
      });
      const scoped = conn("greenhouse", {
        async *fetch(ctx) {
          yield { id: "a:2" };
          ctx.reportPartial("b", new Error("fora do ar"));
          ctx.reportScope(["a:"]);
        },
      });
      await runCollection({
        db,
        sources: ["greenhouse"],
        now: new Date(T0.getTime() + 3_600_000),
        connectors: { greenhouse: scoped },
      });
      const m = await missed(db);
      expect(m["a:1"]).toBe(1);
      expect(m["b:1"]).toBe(0);
    });

    it("ctx.deadlineAt reserva margem para a requisição em andamento e a gravação (60 s de busca)", async () => {
      const db = await testDb();
      const seen: number[] = [];
      const probe = conn("greenhouse", {
        async *fetch(ctx) {
          seen.push(ctx.deadlineAt);
          yield { id: "p1" };
        },
      });
      const START = 1_000_000;
      const clock = () => START;
      // Budget padrão (240 s): a busca vai até 60 s depois do início da fonte, deixando 30 s para
      // a requisição em andamento (timeout de 20 s) e a gravação dentro dos 90 s da fonte.
      await runCollection({ db, sources: ["greenhouse"], now: T0, clock, connectors: { greenhouse: probe } });
      expect(seen[0]).toBe(START + 60_000);

      // Budget curto (60 s): o prazo é o fim do budget menos o rabo (5 s) e a reserva (60 s / 8 = 7,5 s).
      seen.length = 0;
      await runCollection({ db, sources: ["greenhouse"], now: T0, clock, budgetMs: 60_000, connectors: { greenhouse: probe } });
      expect(seen[0]).toBe(START + 60_000 - 5_000 - 7_500);
    });

    it("fonte que começa sem margem para buscar e gravar é pulada sem tocar no cursor nem na expiração", async () => {
      const db = await testDb();
      await runCollection({
        db,
        sources: ["ashby"],
        now: T0,
        connectors: { ashby: conn("ashby", { items: [{ id: "a:1" }] }) },
      });
      await db.update(sourceState).set({ cursor: "7" }).where(eq(sourceState.source, "ashby"));
      const markSpy = vi.spyOn(expire, "markMissedRuns");
      const lateFetch = vi.fn();
      try {
        // Relógio injetado: budget padrão (240 s), sem margem a partir de 240 − 5 − 30 = 205 s.
        // A fonte 1 "consome" 206 s avançando o relógio, sem espera real.
        let fakeNow = 1_000_000;
        const clock = () => fakeNow;
        const first = conn("greenhouse", {
          async *fetch() {
            fakeNow += 206_000;
            yield { id: "g1" };
          },
        });
        const late = conn("ashby", {
          async *fetch(ctx) {
            lateFetch();
            ctx.setCursor("99");
            yield { id: "a:2" };
          },
        });
        const T1 = new Date(T0.getTime() + 3_600_000);
        const res = await runCollection({
          db,
          sources: ["greenhouse", "ashby"],
          now: T1,
          clock,
          concurrency: 1,
          connectors: { greenhouse: first, ashby: late },
        });
        expect(res[0]).toMatchObject({ status: "ok", fetched: 1 });
        expect(res[1]).toMatchObject({ status: "skipped", fetched: 0 });
        expect(res[1].error).toContain("sem margem");
        expect(lateFetch).not.toHaveBeenCalled();
        expect(markSpy).not.toHaveBeenCalledWith(expect.anything(), "ashby", expect.anything(), expect.anything(), expect.anything());
        expect(markSpy).not.toHaveBeenCalledWith(expect.anything(), "ashby", expect.anything(), expect.anything(), expect.anything(), expect.anything());
      } finally {
        markSpy.mockRestore();
      }
      const s = await state(db, "ashby");
      expect(s.cursor).toBe("7");
      expect(s.consecutiveFailures).toBe(0);
      expect(s.lockedUntil).toBeNull();
      const runs = await db.select().from(sourceRuns).where(eq(sourceRuns.source, "ashby"));
      expect(runs).toHaveLength(1);
      const [a1] = await db.select().from(jobSources).where(eq(jobSources.externalId, "a:1"));
      expect(a1.missedRuns).toBe(0);
    });
  });

  describe("fonte incremental que revisita o catálogo", () => {
    const HOUR = 3_600_000;
    const at = (h: number) => new Date(T0.getTime() + h * HOUR);
    const incremental = (id: SourceId, items: Raw[], over: Partial<Connector> = {}) =>
      conn(id, { fullSnapshot: false, items, ...over });

    async function missedOf(db: Awaited<ReturnType<typeof testDb>>, externalId: string) {
      const [r] = await db.select().from(jobSources).where(eq(jobSources.externalId, externalId));
      return r.missedRuns;
    }

    const four = (items: Raw[]) => incremental("fourdayweek", items, { revisitsCatalogWithinHours: 24 });

    it("conta coleta perdida só para linhas não vistas há mais que o ciclo declarado, e expira", async () => {
      const db = await testDb();
      const run = (h: number, items: Raw[]) =>
        runCollection({ db, sources: ["fourdayweek"], now: at(h), connectors: { fourdayweek: four(items) } });

      await run(0, [{ id: "a" }, { id: "b" }]);
      // Coletas horárias sem "b": dentro do ciclo de 24 h ainda não conta como perdida.
      for (let h = 1; h <= 24; h++) await run(h, [{ id: "a" }]);
      expect(await missedOf(db, "b")).toBe(0);
      await run(25, [{ id: "a" }]);
      expect(await missedOf(db, "b")).toBe(1);
      // Coleta vazia (fetched 0) não conta nada.
      await run(26, []);
      expect(await missedOf(db, "b")).toBe(1);
      await run(27, [{ id: "a" }]);
      expect(await missedOf(db, "b")).toBe(2);
      expect(await missedOf(db, "a")).toBe(0);
      await run(28, [{ id: "a" }]);
      expect(await missedOf(db, "b")).toBe(3);

      const [bSrc] = await db.select().from(jobSources).where(eq(jobSources.externalId, "b"));
      const [aSrc] = await db.select().from(jobSources).where(eq(jobSources.externalId, "a"));
      const [bJob] = await db.select().from(jobs).where(eq(jobs.id, bSrc.jobId));
      const [aJob] = await db.select().from(jobs).where(eq(jobs.id, aSrc.jobId));
      expect(bJob.expiredAt).not.toBeNull();
      expect(aJob.expiredAt).toBeNull();
    });

    it("depois de uma parada maior que o ciclo, a volta não conta coleta perdida até cobrir o ciclo de novo", async () => {
      const db = await testDb();
      const run = (h: number, items: Raw[]) =>
        runCollection({ db, sources: ["fourdayweek"], now: at(h), connectors: { fourdayweek: four(items) } });

      for (let h = 0; h <= 2; h++) await run(h, [{ id: "a" }, { id: "b" }]);
      // Parada de 30 h; na volta o catálogo ainda está sendo revisto e "b" não reaparece logo.
      for (let h = 33; h <= 40; h++) await run(h, [{ id: "a" }]);
      expect(await missedOf(db, "b")).toBe(0);
    });

    it("fonte incremental sem ciclo declarado não conta coleta perdida", async () => {
      const db = await testDb();
      await runCollection({ db, sources: ["himalayas"], now: at(0), connectors: { himalayas: incremental("himalayas", [{ id: "h1" }, { id: "h2" }]) } });
      for (const h of [30, 31, 32, 33]) {
        await runCollection({ db, sources: ["himalayas"], now: at(h), connectors: { himalayas: incremental("himalayas", [{ id: "h1" }]) } });
      }
      expect(await missedOf(db, "h2")).toBe(0);
    });
  });

  it("repassa o limite de bytes de resposta do conector ao fetch seguro", async () => {
    const db = await testDb();
    const spy = vi.spyOn(http, "createSafeFetch");
    try {
      await runCollection({
        db,
        sources: ["greenhouse", "ashby"],
        now: T0,
        connectors: {
          greenhouse: conn("greenhouse", { items: [{ id: "g1" }], maxResponseBytes: 25 * 1024 * 1024 }),
          ashby: conn("ashby", { items: [{ id: "a1" }] }),
        },
      });
      expect(spy).toHaveBeenCalledWith(["boards.example.com"], { maxBytes: 25 * 1024 * 1024 });
      expect(spy).toHaveBeenCalledWith(["boards.example.com"], { maxBytes: undefined });
    } finally {
      spy.mockRestore();
    }
  });

  it("janela inteira de boards falha: erro registrado e cursor do rodízio avança", async () => {
    const db = await testDb();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const c = conn("greenhouse", {
        fetch: (ctx) =>
          fetchBoardsPooled(ctx, "Greenhouse", ["a", "b", "c"], async () => {
            throw new Error("404");
          }),
      });
      const [r] = await runCollection({ db, sources: ["greenhouse"], now: T0, connectors: { greenhouse: c } });
      expect(r.status).toBe("error");
      expect((await state(db, "greenhouse")).cursor).toBe("0");
      expect((await state(db, "greenhouse")).consecutiveFailures).toBe(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("um upsert com erro não derruba o lote nem a fonte", async () => {
    const db = await testDb();
    const items: Raw[] = [{ id: "j0" }, { id: "j1" }, { id: "j2" }];
    const c = conn("greenhouse", {
      items,
      normalize(raw) {
        const n = norm(raw);
        if (n && (raw as Raw).id === "j1") return { ...n, company: null as unknown as string };
        return n;
      },
    });
    const [r] = await runCollection({ db, sources: ["greenhouse"], now: T0, connectors: { greenhouse: c } });
    expect(r.status).toBe("ok");
    expect(r.fetched).toBe(3);
    expect(r.inserted).toBe(2);
    expect(r.errors).toBe(1);
    expect(await countJobs(db)).toBe(2);
    // Status ok, mas o resumo das vagas que falharam fica em source_runs.error.
    const [run] = await db.select().from(sourceRuns);
    expect(run.status).toBe("ok");
    expect(run.error).toMatch(/1 vaga\(s\) com erro/);
    expect(run.error).toContain("j1");
    expect(r.error).toBe(run.error);
  });

  it("descarta não-tech silenciosamente e conta 'skipped' do upsert como nem novo nem atualizado", async () => {
    const db = await testDb();
    const items: Raw[] = [
      { id: "a" },
      { id: "b", title: "skip" },
      { id: "d", publishedAt: addDays(T0, -60) },
    ];
    const [r] = await runCollection({
      db,
      sources: ["greenhouse"],
      now: T0,
      connectors: { greenhouse: conn("greenhouse", { items }) },
    });
    expect(r).toMatchObject({ status: "ok", fetched: 3, inserted: 1, updated: 0, errors: 0 });
  });

  it("processa mais de 100 vagas em vários lotes", async () => {
    const db = await testDb();
    const [r] = await runCollection({
      db,
      sources: ["greenhouse"],
      now: T0,
      connectors: { greenhouse: conn("greenhouse", { items: range(230) }) },
    });
    expect(r).toMatchObject({ status: "ok", fetched: 230, inserted: 230 });
  });

  it("estourar o budget aborta o conector, marca erro e não grava o cursor", async () => {
    const db = await testDb();
    const slow = conn("himalayas", {
      fullSnapshot: false,
      async *fetch(ctx) {
        ctx.setCursor("nao-deve-gravar");
        yield { id: "h1" };
        await new Promise<never>((_, reject) => {
          ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
        });
      },
    });
    const started = Date.now();
    const [r] = await runCollection({ db, sources: ["himalayas"], now: T0, budgetMs: 150, connectors: { himalayas: slow } });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(r.status).toBe("error");
    expect(r.error).toContain("budget esgotado");
    const s = await state(db, "himalayas");
    expect(s.cursor).toBeNull();
    expect(s.lockedUntil).toBeNull();
  });

  it("um conector que ignora o sinal também é cortado no budget", async () => {
    const db = await testDb();
    const stuck = conn("greenhouse", {
      async *fetch() {
        await new Promise<never>(() => undefined);
        yield 1;
      },
    });
    const [r] = await runCollection({ db, sources: ["greenhouse"], now: T0, budgetMs: 100, connectors: { greenhouse: stuck } });
    expect(r.status).toBe("error");
    expect(r.error).toContain("budget esgotado");
  });

  it("o budget é da execução inteira: segunda fonte não ganha relógio novo", async () => {
    const db = await testDb();
    const slow = (id: SourceId) =>
      conn(id, {
        async *fetch(ctx) {
          await new Promise<never>((_, reject) => {
            ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
          });
          yield 1;
        },
      });
    const old = await insertJobRaw(db, { published_at: addDays(T0, -100) });
    const started = Date.now();
    const res = await runCollection({
      db,
      sources: ["greenhouse", "ashby"],
      now: T0,
      budgetMs: 400,
      concurrency: 1,
      connectors: { greenhouse: slow("greenhouse"), ashby: slow("ashby") },
    });
    expect(Date.now() - started).toBeLessThan(400 + 150);
    expect(res[0]).toMatchObject({ status: "error", error: "budget esgotado" });
    expect(res[1]).toMatchObject({ status: "skipped", error: "budget esgotado antes de iniciar" });
    expect(await db.select().from(sourceRuns).where(eq(sourceRuns.source, "ashby"))).toHaveLength(0);
    const [o] = await db.select().from(jobs).where(eq(jobs.id, old.id));
    expect(o.expiredAt).not.toBeNull(); // expireJobs ainda rodou
  });

  it("respeita o limite de concorrência", async () => {
    const db = await testDb();
    let running = 0;
    let peak = 0;
    const mk = (id: SourceId) =>
      conn(id, {
        async *fetch() {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 40));
          running -= 1;
          yield { id: `${id}-1` };
        },
      });
    const sources: SourceId[] = ["greenhouse", "ashby", "lever"];
    const res = await runCollection({
      db,
      sources,
      now: T0,
      concurrency: 2,
      connectors: { greenhouse: mk("greenhouse"), ashby: mk("ashby"), lever: mk("lever") },
    });
    expect(res.map((r) => r.status)).toEqual(["ok", "ok", "ok"]);
    expect(peak).toBe(2);
  });

  it("expira vagas ao final e só apaga (retenção) na execução das 03h UTC", async () => {
    const db = await testDb();
    const old = await insertJobRaw(db, { published_at: addDays(T0, -100), expired_at: addDays(T0, -40) });
    const fresh = await insertJobRaw(db, { published_at: addDays(T0, -50) });
    const spy = vi.spyOn(expire, "purgeExpired");
    try {
      const invalidate = vi.fn().mockResolvedValue(undefined);
      await runCollection({ db, sources: [], now: T0, connectors: {}, invalidate }); // 12:00 UTC
      expect(spy).not.toHaveBeenCalled();
      const [f] = await db.select().from(jobs).where(eq(jobs.id, fresh.id));
      expect(f.expiredAt).not.toBeNull(); // > 45 dias
      expect(invalidate).toHaveBeenCalledWith("jobs");

      const at = new Date("2026-06-02T03:17:00.000Z");
      const inv2 = vi.fn().mockResolvedValue(undefined);
      await runCollection({ db, sources: [], now: at, connectors: {}, invalidate: inv2 });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(await db.select().from(jobs).where(eq(jobs.id, old.id))).toHaveLength(0);
      expect(inv2).toHaveBeenCalledWith("jobs");
    } finally {
      spy.mockRestore();
    }
  });

  it("falha na invalidação é registrada, não lançada", async () => {
    const db = await testDb();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const [r] = await runCollection({
        db,
        sources: ["greenhouse"],
        now: T0,
        connectors: { greenhouse: conn("greenhouse", { items: range(1) }) },
        invalidate: () => Promise.reject(new Error("sem cache")),
      });
      expect(r.status).toBe("ok");
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
    }
  });

  describe("atalho de vagas inalteradas", () => {
    const T1 = new Date(T0.getTime() + 3_600_000);

    it("hash igual: pula enrich e upsert, renova last_seen_at e missed_runs num UPDATE só e não toca jobs", async () => {
      const db = await testDb();
      const c = conn("greenhouse", { items: range(3) });
      await runCollection({ db, sources: ["greenhouse"], now: T0, connectors: { greenhouse: c } });
      await db.update(jobSources).set({ missedRuns: 2 });
      const before = await db.select({ id: jobs.id, updatedAt: jobs.updatedAt }).from(jobs).orderBy(jobs.id);

      const enrichSpy = vi.spyOn(enrich, "enrichJob");
      const upsertSpy = vi.spyOn(upsert, "upsertJob");
      try {
        const [r] = await runCollection({ db, sources: ["greenhouse"], now: T1, connectors: { greenhouse: c } });
        expect(r).toMatchObject({ status: "ok", fetched: 3, inserted: 0, updated: 0, unchanged: 3, errors: 0 });
        expect(enrichSpy).not.toHaveBeenCalled();
        expect(upsertSpy).not.toHaveBeenCalled();
      } finally {
        enrichSpy.mockRestore();
        upsertSpy.mockRestore();
      }

      const srcs = await db.select().from(jobSources);
      expect(srcs).toHaveLength(3);
      for (const s of srcs) expect(s).toMatchObject({ lastSeenAt: T1, missedRuns: 0 });
      const after = await db.select({ id: jobs.id, updatedAt: jobs.updatedAt }).from(jobs).orderBy(jobs.id);
      expect(after).toEqual(before);
      expect(after.every((j) => j.updatedAt.getTime() === T0.getTime())).toBe(true);
    });

    it("conteúdo novo ou URL nova na fonte seguem o caminho completo", async () => {
      const db = await testDb();
      await runCollection({ db, sources: ["greenhouse"], now: T0, connectors: { greenhouse: conn("greenhouse", { items: range(2) }) } });
      const changed = conn("greenhouse", {
        items: range(2),
        normalize(raw) {
          const n = norm(raw);
          if (!n) return n;
          if (n.externalId === "j0") return { ...n, descriptionHtml: "<p>Vaga de React j0, agora com Node</p>" };
          return { ...n, url: `${n.url}?gh_jid=2` };
        },
      });
      const [r] = await runCollection({ db, sources: ["greenhouse"], now: T1, connectors: { greenhouse: changed } });
      expect(r).toMatchObject({ status: "ok", updated: 1, unchanged: 1 });
      const [j1] = await db.select().from(jobSources).where(eq(jobSources.externalId, "j1"));
      expect(j1.url).toBe("https://boards.example.com/acme/j1?gh_jid=2");
      expect(j1.lastSeenAt).toEqual(T1);
    });

    it("subir a versão do sanitizador tira a vaga do atalho e re-sanitiza o HTML", async () => {
      const db = await testDb();
      const c = conn("greenhouse", { items: [{ id: "j0" }] });
      await runCollection({ db, sources: ["greenhouse"], now: T0, connectors: { greenhouse: c } });
      // Simula a vaga gravada pela versão anterior do sanitizador.
      const oldHash = enrich.computeContentHash(norm({ id: "j0" })!, SANITIZER_VERSION - 1);
      await db.update(jobs).set({ contentHash: oldHash, descriptionHtml: "<p>velho</p>", sanitizerVersion: SANITIZER_VERSION - 1 });

      const [r] = await runCollection({ db, sources: ["greenhouse"], now: T1, connectors: { greenhouse: c } });
      expect(r).toMatchObject({ status: "ok", updated: 1, unchanged: 0 });
      const [j] = await db.select().from(jobs);
      expect(j.descriptionHtml).toBe("<p>Vaga de React j0</p>");
      expect(j.sanitizerVersion).toBe(SANITIZER_VERSION);
      expect(j.contentHash).toBe(enrich.computeContentHash(norm({ id: "j0" })!));
    });
  });

  describe("falha parcial de board", () => {
    const BOARDS = ["acme", "globex"] as const;
    const multiBoard = (failing: string | null) =>
      conn("greenhouse", {
        fetch: (ctx) =>
          fetchBoardsPooled(ctx, "Greenhouse", BOARDS, async (board) => {
            if (board === failing) throw new TypeError(`HTTP 503 em ${board}`);
            return [{ id: `${board}:1` }, { id: `${board}:2` }];
          }),
      });

    it("registra o board em source_runs.error e conta coleta perdida só no escopo lido", async () => {
      const db = await testDb();
      await runCollection({ db, sources: ["greenhouse"], now: T0, connectors: { greenhouse: multiBoard(null) } });
      const markSpy = vi.spyOn(expire, "markMissedRuns");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const T1 = new Date(T0.getTime() + 3_600_000);
        const [r] = await runCollection({ db, sources: ["greenhouse"], now: T1, connectors: { greenhouse: multiBoard("globex") } });
        expect(r).toMatchObject({ status: "ok", fetched: 2 });
        expect(r.error).toContain("globex");
        expect(markSpy).toHaveBeenCalledWith(expect.anything(), "greenhouse", T1, 2, null, ["acme:"]);
      } finally {
        markSpy.mockRestore();
        warn.mockRestore();
      }

      const runs = await db.select().from(sourceRuns).orderBy(sourceRuns.id);
      expect(runs[0].error).toBeNull();
      expect(runs[1].status).toBe("ok");
      expect(runs[1].error).toContain("globex");
      expect(runs[1].error).toContain("TypeError: HTTP 503 em globex");
      expect(runs[1].error).not.toContain("acme");
      const srcs = await db.select().from(jobSources).orderBy(jobSources.externalId);
      expect(srcs.map((s) => [s.externalId, s.missedRuns])).toEqual([
        ["acme:1", 0],
        ["acme:2", 0],
        ["globex:1", 0],
        ["globex:2", 0],
      ]);
    });
  });
});
