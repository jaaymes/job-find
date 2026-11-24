/**
 * Termos (checados em 2026-11-24): API pública e gratuita, sem chave (https://www.arbeitnow.com/blog/job-board-api);
 * `meta.terms` pede "não abusar" e um link de volta; robots.txt sem restrições. Envelope `{ data, links, meta }`,
 * 300 vagas por página (cerca de 2 MB), mais novas primeiro; `remote` é booleano; `created_at` é epoch em segundos.
 * As URLs das vagas ficam em arbeitnow.com e nos domínios .co.uk, .fr, .ch e .nl.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ARBEITNOW_HOST, arbeitnow } from "@/lib/server/sources/arbeitnow";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { classifyOrigin } from "@/lib/server/enrich/origin";
import { safeUrl } from "@/lib/shared/url";
import { collect, fakeCtx } from "./helpers";

type Raw = { slug: string; remote: boolean; title: string; url: string };
type Page = { data: Raw[]; links: { next: string | null }; meta: Record<string, unknown> };
const dir = resolve(import.meta.dirname, "../../../fixtures/sources/arbeitnow");
const load = (name: string) => JSON.parse(readFileSync(resolve(dir, `${name}.json`), "utf8")) as Page;
const page1 = load("page-1");
const page2 = load("page-2");
const remoteOf = (p: Page) => p.data.filter((j) => j.remote);

/** Páginas 1 e 2 da fixture; as demais repetem a 2 com `next` para forçar o teto. */
function serve(opts: { endless?: boolean } = {}) {
  return (url: URL): unknown => {
    if (url.origin !== `https://${ARBEITNOW_HOST}` || url.pathname !== "/api/job-board-api") return undefined;
    const n = Number(url.searchParams.get("page") ?? "1");
    if (n === 1) return page1;
    return opts.endless ? { ...page2, links: { next: "x" } } : page2;
  };
}

describe("conector Arbeitnow", () => {
  it("declara os metadados e está registrado (incremental)", () => {
    expect(arbeitnow.id).toBe("arbeitnow");
    expect(arbeitnow.fullSnapshot).toBe(false);
    expect(arbeitnow.revisitsCatalogWithinHours).toBeUndefined();
    expect(arbeitnow.brazilian).toBe(false);
    expect(arbeitnow.minIntervalMinutes).toBe(60);
    expect(arbeitnow.allowedHosts).toEqual([ARBEITNOW_HOST]);
    expect(arbeitnow.attribution).toEqual({ label: "Arbeitnow", url: "https://www.arbeitnow.com", dofollow: false });
    expect(CONNECTORS.arbeitnow).toBe(arbeitnow);
  });

  it("segue a paginação até links.next ser nulo e entrega só vagas remotas", async () => {
    const ctx = fakeCtx({ serve: serve() });
    const raws = (await collect(arbeitnow.fetch(ctx))) as Raw[];
    expect(ctx.requests.map((r) => new URL(r.url).searchParams.get("page"))).toEqual(["1", "2"]);
    expect(raws.every((r) => r.remote)).toBe(true);
    expect(raws.map((r) => r.slug)).toEqual([...remoteOf(page1), ...remoteOf(page2)].map((r) => r.slug));
  });

  it("no máximo 3 páginas, mesmo que a API continue", async () => {
    const ctx = fakeCtx({ serve: serve({ endless: true }) });
    await collect(arbeitnow.fetch(ctx));
    expect(ctx.requests).toHaveLength(3);
  });

  it("para depois da página atual quando o prazo da fonte acaba", async () => {
    const ctx = fakeCtx({ serve: serve({ endless: true }), deadlineAt: Date.now() - 1 });
    await collect(arbeitnow.fetch(ctx));
    expect(ctx.requests).toHaveLength(1);
  });

  it("falha quando a API responde erro ou fora do formato", async () => {
    await expect(collect(arbeitnow.fetch(fakeCtx({ serve: () => undefined })))).rejects.toThrow(/404/);
    await expect(collect(arbeitnow.fetch(fakeCtx({ serve: () => ({ nope: 1 }) })))).rejects.toThrow(/formato/);
  });

  it("ids repetidos entre páginas são emitidos uma vez", async () => {
    const dup = (url: URL): unknown => (url.searchParams.get("page") === "1" || !url.searchParams.get("page") ? page1 : { ...page1, links: { next: null } });
    const raws = (await collect(arbeitnow.fetch(fakeCtx({ serve: dup })))) as Raw[];
    expect(new Set(raws.map((r) => r.slug)).size).toBe(raws.length);
  });

  it("normaliza as vagas remotas da fixture", async () => {
    const raws = await collect(arbeitnow.fetch(fakeCtx({ serve: serve() })));
    const jobs = raws.map(arbeitnow.normalize);
    expect(jobs.every((j) => j !== null)).toBe(true);
    for (const j of jobs) {
      expect(j!.externalId).toBeTruthy();
      expect(safeUrl(j!.url)).toBe(j!.url);
      expect(new URL(j!.url).hostname).toMatch(/^www\.arbeitnow\.(com|co\.uk|fr|ch|nl)$/);
      expect(j!.descriptionFormat).toBe("html");
      expect(j!.workModeHint).toBe("remote");
      expect(j!.publishedAt).toBeInstanceOf(Date);
    }
    expect(arbeitnow.normalize({ lixo: true })).toBeNull();
  });

  it("mapeia empresa, tags, tipos de contrato e data (epoch em segundos)", () => {
    const raw = page1.data.find((j) => j.remote)!;
    const j = arbeitnow.normalize(raw)!;
    expect(j.externalId).toBe(raw.slug);
    expect(j.title).toBe(raw.title);
    expect(j.company).toBe((raw as unknown as { company_name: string }).company_name);
    expect(j.tags).toEqual(expect.arrayContaining([...(raw as unknown as { tags: string[] }).tags]));
    expect(j.publishedAt?.getTime()).toBe((raw as unknown as { created_at: number }).created_at * 1000);
  });

  it("sem região elegível: a origem fica unknown e acceptsBrazil null (nunca true)", async () => {
    const raws = await collect(arbeitnow.fetch(fakeCtx({ serve: serve() })));
    for (const j of raws.map(arbeitnow.normalize).filter((x) => x !== null)) {
      expect(j.eligibleRegions).toEqual([]);
      const o = classifyOrigin({ country: j.country, locationText: j.locationText, eligibleRegions: j.eligibleRegions, sourceIsBrazilian: false });
      expect(o, `${j.title} (${j.locationText})`).toEqual({ origin: "unknown", acceptsBrazil: null });
    }
  });

  it("descarta vaga não remota e URL de domínio estranho", () => {
    const notRemote = page1.data.find((j) => !j.remote)!;
    expect(arbeitnow.normalize(notRemote)).toBeNull();
    const remote = page1.data.find((j) => j.remote)!;
    expect(arbeitnow.normalize({ ...remote, url: "https://www.arbeitnow.evil.com/jobs/x" })).toBeNull();
    expect(arbeitnow.normalize({ ...remote, url: "https://evil.example/jobs/x" })).toBeNull();
  });
});
