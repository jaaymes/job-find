/**
 * Spike (Get on Board, API pública v0, checada em 2026-11-24, sem chave):
 * - Endpoint: GET https://www.getonbrd.com/api/v0/categories/<categoria>/jobs?per_page=100&page=N&expand=["company","tags"];
 *   envelope `{ data: [{ id, type, attributes, links }], meta: { page, per_page, total_pages } }`.
 * - Sem `expand`, `company` e `tags` vêm só como ids; com `expand=["company","tags"]` vêm com `name`/`logo`/`country`.
 * - Campos usados: `id` (slug), `links.public_url`, `attributes.title`, `description` + `projects` + `functions` +
 *   `desirable` + `benefits` (HTML, cada um com `*_headline`), `remote_modality` (fully_remote | remote_local |
 *   hybrid | no_remote), `countries` (nomes em inglês, "Remote" para remoto, mas "Brasil" em português),
 *   `min_salary`/`max_salary` (inteiros, sem moeda nem período no payload: o site exibe em USD por mês),
 *   `published_at` (epoch em segundos), `seniority.data.id` (1 a 5) e `tags.data[].attributes.name`.
 * - Limite: 20 requisições a cada 5 s por IP (valor operacional, pode mudar).
 * - Termos (https://www.getonbrd.com/help/how-can-i-use-get-on-board-public-api-to-show-jobs-on-my-site): sem chave;
 *   crédito "Get on Board" ao lado de cada vaga com link para `public_url`; candidatura na página original; atualizar
 *   a cada 24 h e remover a vaga em até 24 h depois que a API deixa de devolvê-la; proibido repassar os dados,
 *   treinar modelos com eles e usar em produto que cobre candidatos.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GETONBOARD_CATEGORIES, GETONBOARD_HOST, getonboard } from "@/lib/server/sources/getonboard";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { safeUrl } from "@/lib/shared/url";
import { collect, fakeCtx } from "./helpers";

type Raw = { id: string; attributes: Record<string, unknown>; links: { public_url: string } };
type Page = { data: Raw[]; meta: { page: number; per_page: number; total_pages: number } };

const dir = resolve(import.meta.dirname, "../../../fixtures/sources/getonboard");
const load = (name: string) => JSON.parse(readFileSync(resolve(dir, `${name}.json`), "utf8")) as Page;
const programming1 = load("programming-1");
const programming2 = load("programming-2");
const cybersecurity1 = load("cybersecurity-1");
const designUx1 = load("design-ux-1");

const byId = (page: Page, prefix: string) => page.data.find((j) => j.id.startsWith(prefix))!;
const fullyRemote = byId(programming1, "senior-technical-project-manager");
const remoteLocal = byId(programming1, "semi-senior-software-engineer-python");
const hybridChile = byId(programming1, "software-engineer-technical-lead");
const onsiteChile = byId(programming1, "desarrollador-full-stack-junior");
const hybridBrazil = designUx1.data[0]!;

/** Página cheia (100 itens) feita clonando a primeira vaga com ids novos. */
function fullPage(n: number): Page {
  const data = Array.from({ length: 100 }, (_, i) => ({ ...fullyRemote, id: `clone-${n}-${i}` }));
  return { data, meta: { page: n, per_page: 100, total_pages: 99 } };
}

/** Serve as fixtures como a API real, só para `/api/v0/categories/<cat>/jobs`. */
function serve(pages: Record<string, Record<number, Page>>) {
  return (url: URL): unknown => {
    if (url.origin !== `https://${GETONBOARD_HOST}`) return undefined;
    const m = /^\/api\/v0\/categories\/([^/]+)\/jobs$/.exec(url.pathname);
    if (!m) return undefined;
    const page = Number(url.searchParams.get("page") ?? "1");
    return pages[m[1]!]?.[page] ?? { data: [], meta: { page, per_page: 100, total_pages: page } };
  };
}

describe("conector Get on Board", () => {
  it("declara os metadados e está registrado", () => {
    expect(getonboard.id).toBe("getonboard");
    expect(getonboard.brazilian).toBe(false);
    expect(getonboard.fullSnapshot).toBe(true);
    expect(getonboard.minIntervalMinutes).toBe(60);
    expect(getonboard.allowedHosts).toEqual([GETONBOARD_HOST]);
    expect(getonboard.attribution).toEqual({ label: "Get on Board", url: "https://www.getonbrd.com", dofollow: false });
    expect(GETONBOARD_CATEGORIES).toEqual([
      "programming",
      "sysadmin-devops-qa",
      "data-science-analytics",
      "machine-learning-ai",
      "design-ux",
      "cybersecurity",
      "mobile-developer",
    ]);
    expect(CONNECTORS.getonboard).toBe(getonboard);
  });

  it("pagina cada categoria até a página vir com menos de 100 itens", async () => {
    const ctx = fakeCtx({
      serve: serve({
        programming: { 1: fullPage(1), 2: fullPage(2), 3: programming2 },
        cybersecurity: { 1: cybersecurity1 },
      }),
    });
    const items = await collect(getonboard.fetch(ctx)) as { id: string }[];

    const urls = ctx.requests.map((r) => new URL(r.url));
    const pagesOf = (cat: string) =>
      urls.filter((u) => u.pathname === `/api/v0/categories/${cat}/jobs`).map((u) => Number(u.searchParams.get("page")));
    expect(pagesOf("programming").sort()).toEqual([1, 2, 3]);
    expect(pagesOf("cybersecurity")).toEqual([1]);
    expect(pagesOf("design-ux")).toEqual([1]);
    for (const u of urls) {
      expect(u.searchParams.get("per_page")).toBe("100");
      expect(JSON.parse(u.searchParams.get("expand") ?? "[]")).toEqual(["company", "tags"]);
    }
    expect(items).toHaveLength(200 + programming2.data.length + cybersecurity1.data.length);
    // Cada vaga carrega a categoria de onde veio, para formar o externalId.
    expect(items.some((i) => (i as { category?: string }).category === "cybersecurity")).toBe(true);
  });

  it("reporta o escopo das categorias lidas e gira o cursor", async () => {
    const ctx = fakeCtx({ serve: serve({ programming: { 1: programming1 }, "design-ux": { 1: designUx1 } }) });
    await collect(getonboard.fetch(ctx));
    expect(ctx.scopes).toEqual([["programming:", "design-ux:"]]);
    expect(ctx.cursors).toEqual(["0"]);
  });

  it("categoria com páginas infinitas falha e fica fora do escopo", async () => {
    const ctx = fakeCtx({
      serve: (url) => {
        if (url.pathname.includes("/programming/")) return fullPage(Number(url.searchParams.get("page")));
        return url.pathname.includes("/design-ux/") ? designUx1 : { data: [] };
      },
    });
    await collect(getonboard.fetch(ctx));
    expect(ctx.partials.map((p) => p.label)).toEqual(["programming"]);
    expect(ctx.scopes).toEqual([["design-ux:"]]);
  });

  it("normalize descarta presencial ou híbrida fora do Brasil", async () => {
    const ctx = fakeCtx({ serve: serve({ programming: { 1: programming1 } }) });
    const items = await collect(getonboard.fetch(ctx));
    const normalized = items.map((i) => getonboard.normalize(i));
    const ids = normalized.filter((n) => n !== null).map((n) => n.externalId);
    expect(ids).toEqual(
      expect.arrayContaining([`programming:${fullyRemote.id}`, `programming:${remoteLocal.id}`]),
    );
    expect(ids).not.toContain(`programming:${hybridChile.id}`);
    expect(ids).not.toContain(`programming:${onsiteChile.id}`);
    expect(ids).toHaveLength(2);
  });

  it("normalize mantém remota e vagas no Brasil", () => {
    const remote = getonboard.normalize({ ...fullyRemote, category: "programming" });
    expect(remote).toMatchObject({
      externalId: `programming:${fullyRemote.id}`,
      url: fullyRemote.links.public_url,
      title: fullyRemote.attributes.title,
      company: "Synogen Solutions",
      country: null,
      workModeHint: "remote",
      eligibleRegions: ["Worldwide"],
      salary: { min: 3000, max: 4000, currency: "USD", period: "month" },
      publishedAt: new Date((fullyRemote.attributes.published_at as number) * 1000),
    });
    expect(safeUrl(remote!.url)).toBe(remote!.url);
    expect(remote!.descriptionFormat).toBe("html");
    expect(remote!.tags.length).toBeGreaterThan(0);

    const local = getonboard.normalize({ ...remoteLocal, category: "programming" });
    expect(local).toMatchObject({ workModeHint: "remote", eligibleRegions: [], salary: { min: 2000, max: 2200 } });

    const br = getonboard.normalize({ ...hybridBrazil, category: "design-ux" });
    expect(br).toMatchObject({
      externalId: `design-ux:${hybridBrazil.id}`,
      url: hybridBrazil.links.public_url,
      country: "BR",
      workModeHint: "hybrid",
      salary: null,
    });
    expect(br!.locationText).toContain("Brasil");
  });

  it("normalize devolve null para payload fora do formato", () => {
    expect(getonboard.normalize({ id: "x" })).toBeNull();
    expect(getonboard.normalize(null)).toBeNull();
    expect(getonboard.normalize({ ...fullyRemote, category: "programming", links: { public_url: "javascript:alert(1)" } })).toBeNull();
  });
});
