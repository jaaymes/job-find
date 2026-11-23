import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobs, sourceRuns, sourceState } from "@/lib/server/db/schema";
import { acquireLock, releaseLock } from "@/lib/server/collect/lock";
import { runCollection } from "@/lib/server/collect/run";
import * as expire from "@/lib/server/jobs/expire";
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
    expect(inv2).not.toHaveBeenCalled();
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
});
