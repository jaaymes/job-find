/**
 * Spike S-1 (4dayweek, API v2, checada em 2026-11-24, sem chave):
 * - Endpoint: GET https://4dayweek.io/api/v2/jobs; envelope `{ data, page, limit, total, has_more }`.
 * - Paginação: `page` (a partir de 1) e `limit` (máx. 100). Filtros por CSV: `category`, `work_arrangement`;
 *   `country` filtra por país de escritório ou de trabalho remoto permitido.
 * - Ordenação: `posted_at` decrescente (mais nova primeiro), confirmada dentro de cada página e entre páginas.
 * - Campos usados: `id` (UUID), `title`, `url` (página da vaga no 4dayweek), `description` (markdown),
 *   `level` (entry|mid|senior|lead|executive), `work_arrangement`, `locations[]` (`country`, `city`, `continent`),
 *   `skills[]` e `stack[]` (`name`), `salary_min`/`salary_max` em CENTAVOS, `salary_currency` e `salary_period`
 *   (year|month|hour), `posted_at` (ISO 8601) e `company` (`name`, `logo_url`).
 * - Vagas sem `locations` ou sem `company` existem (poucas); sem empresa a vaga é descartada.
 * - Termos (https://4dayweek.io/developers, 2026-11-24): API pública, sem autenticação; 60 req/min por IP; resposta
 *   em cache de 60 s; vaga nova pode demorar até 48 h para aparecer; pedem apenas um link de volta para
 *   https://4dayweek.io. A descrição é o campo de texto `description` (sem HTML).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FOURDAYWEEK_HOST, fourdayweek } from "@/lib/server/sources/fourdayweek";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { safeUrl } from "@/lib/shared/url";
import { collect, fakeCtx } from "./helpers";

type Raw = Record<string, unknown> & { id: string };
type Page = { data: Raw[]; page: number; has_more: boolean };

const dir = resolve(import.meta.dirname, "../../../fixtures/sources/fourdayweek");
const load = (name: string) => JSON.parse(readFileSync(resolve(dir, `${name}.json`), "utf8")) as Page;
const brazil1 = load("brazil-page-1");
const remote1 = load("remote-page-1");
const remote2 = load("remote-page-2");

/** Serve as fixtures como a API real: Brasil só tem a página 1; a remota repete a fixture 2 nas demais. */
function serve(opts: { remoteHasMore?: boolean } = {}) {
  const hasMore = opts.remoteHasMore ?? true;
  return (url: URL): unknown => {
    if (url.origin !== "https://4dayweek.io" || url.pathname !== "/api/v2/jobs") return undefined;
    const page = Number(url.searchParams.get("page") ?? "1");
    if (url.searchParams.get("country") === "Brazil") return page === 1 ? { ...brazil1, has_more: false } : undefined;
    if (url.searchParams.get("work_arrangement") === "remote") {
      if (page === 1) return remote1;
      return { ...remote2, page, has_more: hasMore };
    }
    return undefined;
  };
}

describe("conector 4dayweek", () => {
  it("declara os metadados e está registrado", () => {
    expect(fourdayweek.id).toBe("fourdayweek");
    expect(fourdayweek.brazilian).toBe(false);
    expect(fourdayweek.fullSnapshot).toBe(false);
    // Revê o catálogo remoto em ~5 execuções e a consulta Brasil toda execução: 24 h é teto folgado.
    expect(fourdayweek.revisitsCatalogWithinHours).toBe(24);
    expect(fourdayweek.minIntervalMinutes).toBe(60);
    expect(fourdayweek.allowedHosts).toEqual([FOURDAYWEEK_HOST]);
    expect(fourdayweek.attribution).toEqual({ label: "4 Day Week", url: "https://4dayweek.io", dofollow: false });
    expect(CONNECTORS.fourdayweek).toBe(fourdayweek);
  });

  it("busca primeiro a consulta Brasil inteira, depois a remota a partir do cursor", async () => {
    const ctx = fakeCtx({ serve: serve({ remoteHasMore: false }), cursor: JSON.stringify({ remotePage: 2 }) });
    const raws = (await collect(fourdayweek.fetch(ctx))) as Raw[];
    expect(raws.map((r) => r.id)).toEqual([...brazil1.data, ...remote2.data].map((r) => r.id));

    const urls = ctx.requests.map((r) => new URL(r.url));
    expect(urls.map((u) => u.host)).toEqual(["4dayweek.io", "4dayweek.io"]);
    expect(urls.map((u) => u.pathname)).toEqual(["/api/v2/jobs", "/api/v2/jobs"]);
    const [br, rm] = urls.map((u) => Object.fromEntries(u.searchParams));
    expect(br).toEqual({ limit: "100", page: "1", country: "Brazil", category: "engineering,data,security,product,design" });
    expect(rm).toEqual({ limit: "100", page: "2", work_arrangement: "remote", category: "engineering,data,security" });
  });

  it("sem cursor a remota começa na página 1", async () => {
    const ctx = fakeCtx({ serve: serve({ remoteHasMore: false }) });
    await collect(fourdayweek.fetch(ctx));
    expect(new URL(ctx.requests[1]!.url).searchParams.get("page")).toBe("1");
    const bad = fakeCtx({ serve: serve({ remoteHasMore: false }), cursor: "lixo" });
    await collect(fourdayweek.fetch(bad));
    expect(new URL(bad.requests[1]!.url).searchParams.get("page")).toBe("1");
  });

  it("no máximo 12 páginas por execução", async () => {
    const ctx = fakeCtx({ serve: serve() });
    await collect(fourdayweek.fetch(ctx));
    // 1 página Brasil + 11 remotas, e o cursor aponta para a próxima página remota.
    expect(ctx.requests).toHaveLength(12);
    expect(ctx.cursors).toEqual([JSON.stringify({ remotePage: 12 })]);
  });

  it("remota sem has_more volta o cursor para a página 1", async () => {
    const ctx = fakeCtx({ serve: serve({ remoteHasMore: false }), cursor: JSON.stringify({ remotePage: 5 }) });
    await collect(fourdayweek.fetch(ctx));
    expect(ctx.cursors.at(-1)).toBe(JSON.stringify({ remotePage: 1 }));
  });

  it("para depois de concluir a página atual quando o prazo da fonte acaba", async () => {
    const ctx = fakeCtx({ serve: serve(), deadlineAt: Date.now() - 1 });
    const raws = await collect(fourdayweek.fetch(ctx));
    expect(ctx.requests).toHaveLength(1);
    expect(raws).toHaveLength(brazil1.data.length);
    expect(ctx.cursors).toEqual([]);
  });

  it("id presente nas consultas Brasil e remota é emitido uma vez só", async () => {
    const shared = brazil1.data[0]!;
    const base = serve({ remoteHasMore: false });
    const dupServe = (url: URL): unknown => {
      const body = base(url) as Page | undefined;
      if (body && url.searchParams.get("work_arrangement") === "remote") return { ...body, data: [shared, ...body.data] };
      return body;
    };
    const raws = (await collect(fourdayweek.fetch(fakeCtx({ serve: dupServe })))) as Raw[];
    const ids = raws.map((r) => r.id);
    expect(ids.filter((id) => id === shared.id)).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("teto de páginas cortando a consulta Brasil: a remota não roda e o cursor não muda", async () => {
    const endless = (url: URL): unknown =>
      url.searchParams.get("country") === "Brazil" ? { ...brazil1, has_more: true } : serve()(url);
    const ctx = fakeCtx({ serve: endless, cursor: JSON.stringify({ remotePage: 4 }) });
    await collect(fourdayweek.fetch(ctx));
    expect(ctx.requests).toHaveLength(12);
    expect(ctx.requests.every((r) => new URL(r.url).searchParams.get("country") === "Brazil")).toBe(true);
    expect(ctx.cursors).toEqual([]);
  });

  it("prazo cortando a consulta Brasil: a remota não roda e o cursor não muda", async () => {
    const endless = (url: URL): unknown =>
      url.searchParams.get("country") === "Brazil" ? { ...brazil1, has_more: true } : serve()(url);
    const ctx = fakeCtx({ serve: endless, deadlineAt: Date.now() - 1 });
    await collect(fourdayweek.fetch(ctx));
    expect(ctx.requests).toHaveLength(1);
    expect(ctx.cursors).toEqual([]);
  });

  it("falha com status diferente de 200 ou corpo fora do formato", async () => {
    await expect(collect(fourdayweek.fetch(fakeCtx({ serve: () => undefined })))).rejects.toThrow(/404/);
    await expect(collect(fourdayweek.fetch(fakeCtx({ serve: () => ({ lixo: true }) })))).rejects.toThrow(/formato/);
  });

  describe("normalize", () => {
    const find = (list: Raw[], pred: (r: Raw) => boolean) => {
      const raw = list.find((r) => r.company && pred(r));
      expect(raw).toBeDefined();
      return raw!;
    };
    const countries = (r: Raw) => ((r.locations as { country?: string }[] | undefined) ?? []).map((l) => l.country);

    it("url é a página da vaga no 4dayweek, com empresa, logo e markdown", () => {
      const raw = brazil1.data[0]!;
      const job = fourdayweek.normalize(raw)!;
      expect(job.externalId).toBe(raw.id);
      expect(job.url).toBe(raw.url);
      expect(new URL(job.url).host).toBe("4dayweek.io");
      expect(safeUrl(job.url)).not.toBeNull();
      expect(job.company).toBe("MongoDB");
      expect(job.companyLogoUrl).toMatch(/^https:\/\//);
      expect(job.descriptionFormat).toBe("markdown");
      expect(job.publishedAt).toEqual(new Date("2026-11-20T20:52:58Z"));
      expect(job.seniorityHint).toBe("senior");
    });

    it("converte salário de centavos para unidades, com moeda e período", () => {
      const usd = fourdayweek.normalize(find(remote1.data, (r) => r.salary_min === 10000000))!;
      expect(usd.salary).toEqual({ min: 100000, max: 150000, currency: "USD", period: "year" });
      const eur = fourdayweek.normalize(find(remote2.data, (r) => r.salary_currency === "EUR"))!;
      expect(eur.salary).toMatchObject({ currency: "EUR", period: "year" });
      const hour = fourdayweek.normalize(find(brazil1.data, (r) => r.salary_period === "hour"))!;
      expect(hour.salary).toEqual({ min: 6, max: 6, currency: "USD", period: "hour" });
      expect(fourdayweek.normalize(brazil1.data[0]!)!.salary).toBeNull();
    });

    it("locations com Brasil vira country BR", () => {
      const job = fourdayweek.normalize(find(brazil1.data, (r) => countries(r).includes("Brazil")))!;
      expect(job.country).toBe("BR");
      expect(job.eligibleRegions).toContain("Brazil");
      const other = fourdayweek.normalize(find(remote1.data, (r) => !countries(r).includes("Brazil")))!;
      expect(other.country).toBeNull();
    });

    it("remota vira workModeHint remote e eligibleRegions pelos países", () => {
      const job = fourdayweek.normalize(find(remote1.data, (r) => countries(r).includes("Canada")))!;
      expect(job.workModeHint).toBe("remote");
      expect(job.eligibleRegions).toEqual(["United States", "Canada"]);
      expect(job.locationText).toBe("United States, Canada");
      const hybrid = fourdayweek.normalize(find(brazil1.data, (r) => r.work_arrangement === "hybrid"))!;
      expect(hybrid.workModeHint).toBe("hybrid");
    });

    it("skills e stack viram tags", () => {
      const raw = brazil1.data[0]!;
      const job = fourdayweek.normalize(raw)!;
      expect(job.tags).toEqual(expect.arrayContaining(["Agile", "Microservices", "Python", "Node.js"]));
      expect(new Set(job.tags).size).toBe(job.tags.length);
    });

    it("devolve null sem título, sem empresa ou fora do formato", () => {
      expect(fourdayweek.normalize({ ...brazil1.data[0]!, title: "  " })).toBeNull();
      expect(fourdayweek.normalize({ ...brazil1.data[0]!, title: undefined })).toBeNull();
      expect(fourdayweek.normalize({ ...brazil1.data[0]!, company: undefined })).toBeNull();
      expect(fourdayweek.normalize({ ...brazil1.data[0]!, url: "javascript:alert(1)" })).toBeNull();
      expect(fourdayweek.normalize({ lixo: true })).toBeNull();
    });

    it("data de publicação inválida vira null (o upsert usa o primeiro avistamento)", () => {
      expect(fourdayweek.normalize({ ...brazil1.data[0]!, posted_at: "não é data" })!.publishedAt).toBeNull();
      expect(fourdayweek.normalize({ ...brazil1.data[0]!, posted_at: "" })!.publishedAt).toBeNull();
      expect(fourdayweek.normalize({ ...brazil1.data[0]!, posted_at: null })!.publishedAt).toBeNull();
    });

    it("aceita vaga sem locations", () => {
      const job = fourdayweek.normalize({ ...brazil1.data[0]!, locations: undefined })!;
      expect(job.eligibleRegions).toEqual([]);
      expect(job.country).toBeNull();
    });
  });
});
