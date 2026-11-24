import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APIFY_HOST,
  LINKEDIN_ACTOR,
  LINKEDIN_KEYWORDS,
  MAX_CHARGE_PER_RUN_USD,
  RESULTS_PER_RUN,
  keywordFor,
  linkedin,
} from "@/lib/server/sources/linkedin";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { collect, fakeCtx } from "./helpers";

const dir = resolve(import.meta.dirname, "../../../fixtures/sources/linkedin");
const runs = JSON.parse(readFileSync(resolve(dir, "runs.json"), "utf8")) as {
  data: { items: { id: string; status: string; startedAt: string; defaultDatasetId: string }[] };
};
const dataset = JSON.parse(readFileSync(resolve(dir, "dataset.json"), "utf8")) as { id: string }[];

const RUNS_PATH = `/v2/acts/${LINKEDIN_ACTOR}/runs`;

/** Serve a lista de execuções (GET), o dataset e aceita o início de execução (POST). */
function serveWith(items: typeof runs.data.items) {
  return (url: URL, init?: { method?: string }): unknown => {
    if (url.origin !== `https://${APIFY_HOST}`) return undefined;
    if (url.pathname === RUNS_PATH) return init?.method === "POST" ? { data: { id: "started" } } : { data: { items } };
    if (url.pathname === "/v2/datasets/dsNew/items") return dataset;
    return undefined;
  };
}

beforeEach(() => vi.stubEnv("APIFY_TOKEN", "token-de-teste"));
afterEach(() => vi.unstubAllEnvs());

describe("conector LinkedIn (Apify)", () => {
  it("declara os metadados e está registrado", () => {
    expect(linkedin.id).toBe("linkedin");
    expect(linkedin.fullSnapshot).toBe(false);
    expect(linkedin.allowedHosts).toEqual([APIFY_HOST]);
    expect(linkedin.attribution.label).toBe("LinkedIn");
    expect(CONNECTORS.linkedin).toBe(linkedin);
  });

  it("sem APIFY_TOKEN não faz nenhuma requisição", async () => {
    vi.stubEnv("APIFY_TOKEN", "");
    const ctx = fakeCtx({ serve: serveWith(runs.data.items) });
    expect(await collect(linkedin.fetch(ctx))).toEqual([]);
    expect(ctx.requests).toEqual([]);
  });

  it("ingere o dataset da última execução bem-sucedida e grava o cursor", async () => {
    // A última execução começou há 4 h (now = 2026-11-23T12:00Z): não inicia outra.
    const ctx = fakeCtx({ serve: serveWith(runs.data.items) });
    const raws = (await collect(linkedin.fetch(ctx))) as { id: string }[];
    expect(raws.map((r) => r.id)).toEqual(dataset.map((d) => d.id));
    expect(ctx.cursors).toEqual(["dsNew"]);
    expect(ctx.requests.every((r) => r.headers.Authorization === "Bearer token-de-teste")).toBe(true);
    expect(ctx.requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("não reingere um dataset já lido", async () => {
    const ctx = fakeCtx({ serve: serveWith(runs.data.items), cursor: "dsNew" });
    expect(await collect(linkedin.fetch(ctx))).toEqual([]);
    expect(ctx.requests).toHaveLength(1);
    expect(ctx.cursors).toEqual([]);
  });

  it("inicia nova execução quando a última começou há 12 h ou mais, com teto de gasto", async () => {
    const old = runs.data.items.map((r) => ({ ...r, startedAt: "2026-11-22T23:00:00.000Z" }));
    const ctx = fakeCtx({ serve: serveWith(old), cursor: "dsNew" });
    await collect(linkedin.fetch(ctx));
    const post = ctx.requests.find((r) => r.method === "POST");
    expect(post).toBeDefined();
    const url = new URL(post!.url);
    expect(url.pathname).toBe(RUNS_PATH);
    expect(url.searchParams.get("maxItems")).toBe(String(RESULTS_PER_RUN));
    expect(url.searchParams.get("maxTotalChargeUsd")).toBe(String(MAX_CHARGE_PER_RUN_USD));
    expect(JSON.parse(post!.body!)).toEqual({
      keywords: keywordFor(ctx.now),
      location: "Brazil",
      datePosted: "r86400",
      limit: RESULTS_PER_RUN,
    });
  });

  it("não inicia outra enquanto há execução em andamento", async () => {
    const running = [{ ...runs.data.items[0]!, status: "RUNNING", startedAt: "2026-11-21T00:00:00.000Z" }];
    const ctx = fakeCtx({ serve: serveWith(running) });
    await collect(linkedin.fetch(ctx));
    expect(ctx.requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("primeira coleta sem execuções inicia a primeira", async () => {
    const ctx = fakeCtx({ serve: serveWith([]) });
    expect(await collect(linkedin.fetch(ctx))).toEqual([]);
    expect(ctx.requests.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("rodízio de buscas muda a cada 12 h", () => {
    const a = keywordFor(new Date("2026-11-23T01:00:00Z"));
    const b = keywordFor(new Date("2026-11-23T13:00:00Z"));
    expect(LINKEDIN_KEYWORDS).toContain(a);
    expect(a).not.toBe(b);
  });

  it("normaliza vagas do dataset e descarta URL fora do LinkedIn", () => {
    const [first, intern, foreign] = dataset.map((d) => linkedin.normalize(d));
    expect(first).toMatchObject({
      externalId: "4321000001",
      title: "Desenvolvedor React Pleno",
      company: "Empresa Exemplo",
      country: "BR",
      city: "São Paulo",
      descriptionFormat: "html",
      tags: ["Full-time"],
      seniorityHint: null,
    });
    expect(first!.publishedAt?.toISOString()).toBe("2026-11-23T00:00:00.000Z");
    expect(intern).toMatchObject({ seniorityHint: "intern", country: "BR", descriptionFormat: "markdown" });
    expect(intern!.descriptionHtml).toBe("Estágio remoto em desenvolvimento.");
    expect(foreign).toBeNull();
    expect(linkedin.normalize({ lixo: 1 })).toBeNull();
  });
});
