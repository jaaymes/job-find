/**
 * Testes de contrato contra as APIs reais das fontes (Tarefa 40). Ficam fora dos projetos `unit` e
 * `integration` (config própria, vitest.contract.config.ts) e rodam por `pnpm test:contract` (workflow diário `.github/workflows/contracts.yml`).
 *
 * Cada fonte recebe poucas requisições reais, pelo mesmo `createSafeFetch` do runner (allowlist de hosts
 * do SSRF incluída), e cada item cru é validado com o mesmo schema Zod do conector. Os tokens são
 * opcionais: o conector só os envia quando definidos, e nada é impresso.
 */
import { describe, expect, it } from "vitest";
import { createSafeFetch } from "@/lib/server/sources/http";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { safeUrl } from "@/lib/shared/url";
import type { ConnectorContext, SafeFetch, SafeResponse } from "@/lib/server/sources/types";
import type { SourceId } from "@/lib/shared/types/job";
import type { z } from "@/lib/shared/zod";
import { jobSchema as arbeitnowJob } from "@/lib/server/sources/arbeitnow";
import { ASHBY_BOARDS, jobSchema as ashbyJob } from "@/lib/server/sources/ashby";
import { jobSchema as fourdayweekJob } from "@/lib/server/sources/fourdayweek";
import { jobSchema as getonboardJob } from "@/lib/server/sources/getonboard";
import { GITHUB_REPOS, issueSchema as githubIssue } from "@/lib/server/sources/github";
import { GREENHOUSE_BOARDS, jobSchema as greenhouseJob } from "@/lib/server/sources/greenhouse";
import { jobSchema as himalayasJob } from "@/lib/server/sources/himalayas";
import { commentSchema as hnComment } from "@/lib/server/sources/hn";
import { jobSchema as jobicyJob } from "@/lib/server/sources/jobicy";
import { LEVER_BOARDS, jobSchema as leverJob } from "@/lib/server/sources/lever";
import { jobSchema as remoteokJob } from "@/lib/server/sources/remoteok";
import { SMARTRECRUITERS_BOARDS, jobSchema as smartrecruitersJob } from "@/lib/server/sources/smartrecruiters";
import { itemSchema as wwrItem } from "@/lib/server/sources/wwr";

const TEST_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 30_000;
const RUN_TIMEOUT_MS = 100_000;

type Partial_ = { label: string; message: string };
type Run = { items: unknown[]; partials: Partial_[] };

const asResponse = (text: string): SafeResponse => ({
  status: 200,
  url: "",
  headers: new Headers(),
  text: async () => text,
  json: async () => JSON.parse(text) as unknown,
});

/**
 * Limita a coleta às primeiras requisições: a requisição que `isBeyondFirst` reconhece não vai à rede e
 * recebe uma resposta vazia do formato da fonte (paginação, segunda consulta ou segundo feed).
 */
type Bound = { isBeyondFirst: (url: string) => boolean; emptyBody: string; rewrite?: (url: string) => string };

const BOUNDS: Partial<Record<SourceId, Bound>> = {
  himalayas: { isBeyondFirst: (u) => new URL(u).searchParams.has("cursor"), emptyBody: '{"jobs":[],"nextCursor":null}' },
  fourdayweek: { isBeyondFirst: (u) => new URL(u).searchParams.get("page") !== "1" || new URL(u).searchParams.has("work_arrangement"), emptyBody: '{"data":[],"has_more":false}' },
  getonboard: { isBeyondFirst: (u) => new URL(u).searchParams.get("page") !== "1", emptyBody: '{"data":[]}' },
  github: { isBeyondFirst: (u) => new URL(u).searchParams.get("page") !== "1", emptyBody: "[]" },
  jobicy: { isBeyondFirst: (u) => new URL(u).searchParams.get("geo") !== "brazil", emptyBody: '{"jobs":[]}' },
  // Só 5 vagas por empresa (cada uma custa uma requisição de detalhe) e nenhuma página além da primeira.
  smartrecruiters: {
    isBeyondFirst: (u) => new URL(u).searchParams.get("offset") !== null && new URL(u).searchParams.get("offset") !== "0",
    emptyBody: '{"totalFound":0,"content":[]}',
    rewrite: (u) => {
      const url = new URL(u);
      if (url.searchParams.has("offset")) url.searchParams.set("limit", "5");
      return url.toString();
    },
  },
  // Só a primeira página (300 vagas, cerca de 2 MB) vai à rede.
  arbeitnow: { isBeyondFirst: (u) => new URL(u).searchParams.get("page") !== "1", emptyBody: '{"data":[],"links":{"next":null}}' },
  wwr: { isBeyondFirst: (u) => !u.endsWith("/remote-programming-jobs.rss"), emptyBody: "" },
};

const runs = new Map<SourceId, Promise<Run>>();

/** Uma coleta real por fonte (os testes de contrato e de slugs de um conector compartilham a mesma). */
function collect(id: SourceId): Promise<Run> {
  let run = runs.get(id);
  if (!run) {
    run = doCollect(id);
    runs.set(id, run);
  }
  return run;
}

async function doCollect(id: SourceId): Promise<Run> {
  const connector = CONNECTORS[id];
  if (!connector) throw new Error(`conector ${id} não registrado`);
  const real = createSafeFetch(connector.allowedHosts, { timeoutMs: REQUEST_TIMEOUT_MS });
  const bound = BOUNDS[id];
  const guarded: SafeFetch = (url, init) => (bound?.isBeyondFirst(url) ? Promise.resolve(asResponse(bound.emptyBody)) : real(bound?.rewrite?.(url) ?? url, init));
  const partials: Partial_[] = [];
  const ctx: ConnectorContext = {
    fetchJson: guarded,
    fetchText: guarded,
    cursor: null,
    setCursor: () => undefined,
    reportPartial: (label, error) => partials.push({ label, message: error instanceof Error ? error.message : String(error) }),
    reportScope: () => undefined,
    deadlineAt: Number.POSITIVE_INFINITY,
    signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
    now: new Date(),
  };
  const items: unknown[] = [];
  for await (const raw of connector.fetch(ctx)) items.push(raw);
  return { items, partials };
}

/** Falha nomeando a fonte e o caminho do primeiro problema do Zod. */
function expectItemsParse(source: SourceId, schema: z.ZodType, items: unknown[]): void {
  const failures: string[] = [];
  items.forEach((item, index) => {
    const parsed = schema.safeParse(item);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      failures.push(`item ${index}: "${issue?.path.join(".") || "(raiz)"}" ${issue?.message ?? ""}`.trim());
    }
  });
  expect(failures, `${source}: ${failures.length} de ${items.length} itens fora do schema; primeiro: ${failures[0]}`).toEqual([]);
}

function expectNormalizes(source: SourceId, items: unknown[]): void {
  const connector = CONNECTORS[source]!;
  const normalized = items.map((raw) => connector.normalize(raw)).filter((job) => job !== null);
  expect(normalized.length, `${source}: nenhum dos ${items.length} itens virou NormalizedJob`).toBeGreaterThan(0);
}

async function expectSource(source: SourceId, schema: z.ZodType): Promise<Run> {
  const run = await collect(source);
  expect(run.items.length, `${source}: a API real não devolveu itens`).toBeGreaterThan(0);
  expectItemsParse(source, schema, run.items);
  expectNormalizes(source, run.items);
  return run;
}

/** Todos os slugs ruins de uma vez: 404, erro ou zero vagas, cada um nomeado. */
function badSlugs(run: Run, slugs: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const item of run.items) {
    const board = (item as { board?: string } | null)?.board;
    if (board) counts.set(board, (counts.get(board) ?? 0) + 1);
  }
  const problems: string[] = [];
  for (const slug of slugs) {
    const partial = run.partials.find((p) => p.label === slug);
    if (partial) problems.push(/\b404\b/.test(partial.message) ? `${slug}: 404` : `${slug}: erro (${partial.message})`);
    else if (!counts.get(slug)) problems.push(`${slug}: zero vagas`);
  }
  return problems;
}

describe("contrato das fontes (APIs reais)", () => {
  describe.each([
    ["greenhouse", GREENHOUSE_BOARDS, greenhouseJob],
    ["lever", LEVER_BOARDS, leverJob],
    ["ashby", ASHBY_BOARDS, ashbyJob],
    ["smartrecruiters", SMARTRECRUITERS_BOARDS, smartrecruitersJob],
  ] as const)("%s", (source, slugs, schema) => {
    it("payload real bate com o schema do conector", { timeout: TEST_TIMEOUT_MS }, async () => {
      await expectSource(source, schema);
    });

    it(`todos os ${slugs.length} slugs existem e têm vagas`, { timeout: TEST_TIMEOUT_MS }, async () => {
      const problems = badSlugs(await collect(source), slugs);
      expect(problems, `${source}: slugs ruins (remova da lista no conector): ${problems.join("; ")}`).toEqual([]);
    });
  });

  it("himalayas: payload real bate com o schema do conector", { timeout: TEST_TIMEOUT_MS }, async (ctx) => {
    try {
      await expectSource("himalayas", himalayasJob);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Sem HIMALAYAS_API_KEY a API pode exigir chave: pula só esta fonte, com aviso claro.
      if (!process.env.HIMALAYAS_API_KEY && /HTTP (401|403)/.test(message)) {
        ctx.skip(`himalayas: a API exigiu chave e HIMALAYAS_API_KEY não está definida (${message})`);
      }
      throw error;
    }
  });

  it("fourdayweek: payload real (consulta Brasil) bate com o schema do conector", { timeout: TEST_TIMEOUT_MS }, async () => {
    await expectSource("fourdayweek", fourdayweekJob);
  });

  it("getonboard: payload real bate com o schema e as vagas normalizadas são válidas", { timeout: TEST_TIMEOUT_MS }, async () => {
    const run = await expectSource("getonboard", getonboardJob);
    for (const raw of run.items) {
      const job = CONNECTORS.getonboard!.normalize(raw);
      if (!job) continue;
      expect(job.externalId, "getonboard: externalId fora do padrão categoria:id").toMatch(/^[a-z-]+:.+/);
      expect(safeUrl(job.url), `getonboard: url inválida em ${job.externalId}`).toBe(job.url);
      expect(job.title.length).toBeGreaterThan(0);
    }
  });

  it("jobicy: payload real bate com o schema do conector", { timeout: TEST_TIMEOUT_MS }, async () => {
    await expectSource("jobicy", jobicyJob);
  });

  it("remoteok: payload real bate com o schema do conector", { timeout: TEST_TIMEOUT_MS }, async () => {
    await expectSource("remoteok", remoteokJob);
  });

  it("wwr: RSS real pelo fetch seguro bate com o schema do conector", { timeout: TEST_TIMEOUT_MS }, async () => {
    const run = await expectSource("wwr", wwrItem);
    expect(run.partials.filter((p) => !/remote-devops/.test(p.label)), "wwr: feed principal falhou").toEqual([]);
  });

  it("arbeitnow: payload real só traz vagas remotas e bate com o schema do conector", { timeout: TEST_TIMEOUT_MS }, async () => {
    const run = await expectSource("arbeitnow", arbeitnowJob);
    expect(run.items.every((i) => (i as { remote?: unknown }).remote === true), "arbeitnow: veio vaga não remota").toBe(true);
  });

  it("github: só issues abertas, sem pull requests, e payload bate com o schema", { timeout: TEST_TIMEOUT_MS }, async () => {
    const run = await expectSource("github", githubIssue);
    expect(run.partials, `github: repositórios com falha (de ${GITHUB_REPOS.length})`).toEqual([]);
    const notOpen = run.items.filter((i) => (i as { state?: string }).state !== "open");
    expect(notOpen.length, "github: issue que não está aberta veio na coleta (state=open)").toBe(0);
  });

  it("hn: busca da thread e comentários de topo batem com o schema", { timeout: TEST_TIMEOUT_MS }, async () => {
    const run = await collect("hn");
    expect(run.items.length, "hn: a thread real não devolveu comentários").toBeGreaterThan(0);
    // Comentário apagado vem sem texto: o conector o descarta, então só os com texto entram no schema.
    const live = run.items.filter((c) => typeof (c as { text?: unknown } | null)?.text === "string");
    expect(live.length, "hn: nenhum comentário com texto").toBeGreaterThan(0);
    expectItemsParse("hn", hnComment, live);
    expectNormalizes("hn", live);
  });
});
