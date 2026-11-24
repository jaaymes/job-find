/**
 * Spike (SmartRecruiters, Posting API pública, checada em 2026-11-24, sem chave):
 * - Lista: GET https://api.smartrecruiters.com/v1/companies/<id>/postings?limit=100&offset=N&country=br, envelope
 *   `{ offset, limit, totalFound, content: [...] }`; `country=br` limita às vagas localizadas no Brasil. O id da empresa
 *   diferencia maiúsculas e minúsculas e id inexistente devolve 200 com `totalFound: 0`.
 * - Cada item traz `id`, `name`, `releasedDate`, `location` (`city`, `region`, `country` em minúsculas, `remote`, `hybrid`),
 *   `function.id` (ex.: "information_technology"), `department.label` e `experienceLevel.id`, mas não a descrição.
 * - Detalhe: GET /v1/companies/<id>/postings/<postingId> traz `postingUrl` e `jobAd.sections.*.text` (HTML).
 * - Limites (developers.smartrecruiters.com/docs/rate-limiting): 10 req/s e 8 requisições simultâneas por credencial.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SMARTRECRUITERS_BOARDS } from "@/lib/server/sources/boards/smartrecruiters";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { SMARTRECRUITERS_HOST, createLimiter, smartrecruiters } from "@/lib/server/sources/smartrecruiters";
import { collect, fakeCtx } from "./helpers";

type Item = { id: string; function: { id: string }; location: Record<string, unknown>; [k: string]: unknown };
type List = { offset: number; limit: number; totalFound: number; content: Item[] };

const dir = resolve(import.meta.dirname, "../../../fixtures/sources/smartrecruiters");
const load = <T>(name: string) => JSON.parse(readFileSync(resolve(dir, `${name}.json`), "utf8")) as T;
const list = load<List>("experian-list");
const detail = load<Record<string, unknown>>("experian-detail");

const [hybrid, remote, onsite, nonTech] = list.content as [Item, Item, Item, Item];
const detailFor = (id: string) => ({ ...detail, id, postingUrl: `https://jobs.smartrecruiters.com/Experian/${id}-x` });

/** Serve a API: lista paginada por `offset` e detalhe por id (`totalFound` fixo, itens clonados para paginar). */
function serve(boards: Record<string, { totalFound: number; items: (n: number) => Item }>) {
  return (url: URL): unknown => {
    if (url.origin !== `https://${SMARTRECRUITERS_HOST}`) return undefined;
    const m = /^\/v1\/companies\/([^/]+)\/postings(?:\/([^/]+))?$/.exec(url.pathname);
    const board = m && boards[m[1]!];
    if (!m || !board) return { offset: 0, limit: 100, totalFound: 0, content: [] };
    if (m[2]) return detailFor(m[2]);
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const content = Array.from({ length: Math.max(0, Math.min(limit, board.totalFound - offset)) }, (_, i) => board.items(offset + i));
    return { offset, limit, totalFound: board.totalFound, content };
  };
}

/** Avança o relógio falso (o conector espaça as requisições em 125 ms) até a promessa terminar. */
async function drive<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let turns = 0; !settled; turns++) {
    expect(turns, "o relógio avançou 4.000 vezes e a coleta não terminou").toBeLessThan(4000);
    await vi.advanceTimersByTimeAsync(125);
  }
  return promise;
}

const clone = (n: number): Item => ({ ...hybrid, id: `clone-${n}` });

describe("conector SmartRecruiters", () => {
  afterEach(() => vi.useRealTimers());

  it("declara os metadados e está registrado", () => {
    expect(smartrecruiters.id).toBe("smartrecruiters");
    expect(smartrecruiters.brazilian).toBe(false);
    expect(smartrecruiters.fullSnapshot).toBe(true);
    expect(smartrecruiters.minIntervalMinutes).toBe(60);
    expect(smartrecruiters.allowedHosts).toEqual([SMARTRECRUITERS_HOST]);
    expect(smartrecruiters.attribution).toEqual({
      label: "SmartRecruiters",
      url: "https://www.smartrecruiters.com",
      dofollow: false,
    });
    expect(SMARTRECRUITERS_BOARDS.slice(0, 2)).toEqual(["Experian", "BoschGroup"]);
    expect(CONNECTORS.smartrecruiters).toBe(smartrecruiters);
  });

  it("pagina por offset até totalFound, só vagas do Brasil", async () => {
    vi.useFakeTimers();
    // Só as 3 primeiras são de tecnologia (as demais não custam detalhe): o teste mede a paginação.
    const ctx = fakeCtx({ serve: serve({ Experian: { totalFound: 230, items: (n) => (n < 3 ? clone(n) : { ...nonTech, id: `nt-${n}` }) } }) });
    const items = await drive(collect(smartrecruiters.fetch(ctx)));
    const lists = ctx.requests.map((r) => new URL(r.url)).filter((u) => u.pathname === "/v1/companies/Experian/postings");
    expect(lists.map((u) => u.searchParams.get("offset"))).toEqual(["0", "100", "200"]);
    for (const u of lists) {
      expect(u.searchParams.get("limit")).toBe("100");
      expect(u.searchParams.get("country")).toBe("br");
    }
    expect(items).toHaveLength(3);
  });

  it("totalFound 0 conta como falha do board (id inválido) e fica fora do escopo", async () => {
    const ctx = fakeCtx({ serve: serve({ BoschGroup: { totalFound: 2, items: clone } }) });
    const items = await collect(smartrecruiters.fetch(ctx));
    expect(ctx.partials.map((p) => p.label)).toEqual(["Experian"]);
    expect(ctx.scopes).toEqual([["BoschGroup:"]]);
    expect(items).toHaveLength(2);
  });

  it("só itens de tecnologia buscam o detalhe", async () => {
    const mixed = [hybrid, nonTech, remote];
    const ctx = fakeCtx({ serve: serve({ Experian: { totalFound: 3, items: (n) => mixed[n]! } }) });
    const items = (await collect(smartrecruiters.fetch(ctx))) as { id: string }[];
    const detailIds = ctx.requests
      .map((r) => new URL(r.url).pathname)
      .filter((p) => /\/postings\/[^/]+$/.test(p))
      .map((p) => p.split("/").pop());
    expect(detailIds.sort()).toEqual([hybrid.id, remote.id].sort());
    expect(items.map((i) => i.id).sort()).toEqual([hybrid.id, remote.id].sort());
  });

  it("lista com mais de 20 páginas falha em vez de entregar lista truncada", async () => {
    vi.useFakeTimers();
    const ctx = fakeCtx({ serve: serve({ Experian: { totalFound: 5000, items: (n) => ({ ...nonTech, id: `nt-${n}` }) } }) });
    // BoschGroup não existe no servidor de teste: todos falham e o conector lança.
    await expect(drive(collect(smartrecruiters.fetch(ctx)))).rejects.toThrow();
    expect(ctx.partials.map((p) => p.label).sort()).toEqual(["BoschGroup", "Experian"]);
  });

  it("prazo esgotado no meio do board falha o board, sem entregar vagas pela metade", async () => {
    const ctx = fakeCtx({ serve: serve({ Experian: { totalFound: 3, items: clone } }), deadlineAt: Date.now() - 1 });
    // Passado o prazo só o primeiro board é tentado, e ele falha.
    await expect(collect(smartrecruiters.fetch(ctx))).rejects.toThrow();
    expect(ctx.partials.map((p) => p.label)).toEqual(["Experian"]);
  });

  it("normalize usa a descrição do detalhe e o local com híbrido", () => {
    const job = smartrecruiters.normalize({ ...hybrid, board: "Experian", detail: detailFor(hybrid.id) });
    expect(job).toMatchObject({
      externalId: `Experian:${hybrid.id}`,
      url: `https://jobs.smartrecruiters.com/Experian/${hybrid.id}-x`,
      title: "Analista de Soluções III ( Flutter)",
      company: "Experian",
      companyLogoUrl: null,
      descriptionFormat: "html",
      country: "BR",
      city: "Blumenau",
      workModeHint: "hybrid",
      salary: null,
      publishedAt: new Date("2026-11-23T23:15:36.165Z"),
    });
    expect(job!.locationText).toBe("Blumenau, Brazil");
    expect(job!.descriptionHtml).toContain("Flutter em produção");
    expect(job!.descriptionHtml).toContain("Responsabilidades");
    expect(job!.tags).toContain("Technology");
  });

  it("normalize marca remota e presencial", () => {
    const r = smartrecruiters.normalize({ ...remote, board: "Experian", detail: detailFor(remote.id) });
    expect(r).toMatchObject({ workModeHint: "remote", country: "BR" });
    const o = smartrecruiters.normalize({ ...onsite, board: "Experian", detail: detailFor(onsite.id) });
    expect(o).toMatchObject({ workModeHint: "onsite", country: "BR" });
  });

  it("normalize devolve null sem detalhe ou fora do formato", () => {
    expect(smartrecruiters.normalize({ ...hybrid, board: "Experian" })).toBeNull();
    expect(smartrecruiters.normalize({ id: "x" })).toBeNull();
    expect(smartrecruiters.normalize(null)).toBeNull();
    expect(
      smartrecruiters.normalize({ ...hybrid, board: "Experian", detail: { ...detailFor(hybrid.id), postingUrl: "javascript:alert(1)" } }),
    ).toBeNull();
  });

  describe("requisições de detalhe", () => {
    const isDetail = (url: string) => /\/postings\/[^/]+$/.test(new URL(url).pathname);

    it("nunca passa de 6 detalhes simultâneos, mesmo com 2 empresas e 40 vagas cada", async () => {
      const base = fakeCtx({
        serve: serve({ Experian: { totalFound: 40, items: clone }, BoschGroup: { totalFound: 40, items: clone } }),
      });
      let inFlight = 0;
      let peak = 0;
      const release: (() => void)[] = [];
      const ctx = {
        ...base,
        fetchJson: async (url: string, init?: Parameters<typeof base.fetchJson>[1]) => {
          if (!isDetail(url)) return base.fetchJson(url, init);
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise<void>((resolve) => release.push(resolve));
          inFlight--;
          return base.fetchJson(url, init);
        },
      };
      vi.useFakeTimers();
      const done = collect(smartrecruiters.fetch(ctx));
      // As requisições começam a cada 125 ms e só uma a cada 4 turnos termina: a fila enche até o limite.
      let released = 0;
      for (let turns = 0; released < 80; turns++) {
        expect(turns, `a coleta travou depois de ${released} de 80 detalhes liberados`).toBeLessThan(2000);
        await vi.advanceTimersByTimeAsync(125);
        const next = turns % 4 === 0 ? release.shift() : undefined;
        if (next) {
          next();
          released++;
        }
      }
      expect(await done).toHaveLength(80);
      expect(peak).toBe(6);
    });

    it("detalhe 404 (vaga fechada entre a lista e o detalhe) pula só essa vaga", async () => {
      const mixed = [hybrid, remote, onsite];
      const inner = serve({ Experian: { totalFound: 3, items: (n) => mixed[n]! } });
      const ctx = fakeCtx({ serve: (url) => (url.pathname.endsWith(`/postings/${remote.id}`) ? undefined : inner(url)) });
      const items = (await collect(smartrecruiters.fetch(ctx))) as { id: string }[];
      expect(items.map((i) => i.id).sort()).toEqual([hybrid.id, onsite.id].sort());
      // BoschGroup não existe no servidor de teste; a falha dele não vem do 404 de detalhe.
      expect(ctx.partials.map((p) => p.label)).toEqual(["BoschGroup"]);
    });

    it("detalhe com status diferente de 200 faz o board lançar", async () => {
      const mixed = [hybrid, remote];
      const inner = serve({ Experian: { totalFound: 2, items: (n) => mixed[n]! } });
      const base = fakeCtx({ serve: inner });
      const ctx = {
        ...base,
        fetchJson: async (url: string, init?: Parameters<typeof base.fetchJson>[1]) =>
          isDetail(url) && url.endsWith(remote.id) ? { ...(await base.fetchJson(url, init)), status: 429 } : base.fetchJson(url, init),
      };
      // O 429 repetido faz Experian falhar; BoschGroup não existe no servidor de teste e também falha: com
      // todos os boards falhando o conector lança.
      await expect(collect(smartrecruiters.fetch(ctx))).rejects.toThrow();
      const labels = base.partials.map((p) => p.label);
      expect(labels).toContain("Experian");
      expect(String((base.partials.find((p) => p.label === "Experian")!.error as Error).message)).toContain("429");
    });
  });

  it("sem seção da vaga na descrição, usa o título em vez de descrição vazia", () => {
    const empty = { ...detailFor(hybrid.id), jobAd: { sections: { companyDescription: { text: "<p>Institucional</p>" } } } };
    const job = smartrecruiters.normalize({ ...hybrid, board: "Experian", detail: empty });
    expect(job!.descriptionHtml).toBe("<p>Analista de Soluções III ( Flutter)</p>");
  });

  it("lista que termina com página vazia antes de totalFound encerra sem laço", async () => {
    const ctx = fakeCtx({
      serve: (url) => {
        const m = /^\/v1\/companies\/Experian\/postings(?:\/([^/]+))?$/.exec(url.pathname);
        if (!m) return { offset: 0, limit: 100, totalFound: 0, content: [] };
        if (m[1]) return detailFor(m[1]);
        // totalFound promete 500, mas só a primeira página tem itens.
        return { offset: 0, limit: 100, totalFound: 500, content: url.searchParams.get("offset") === "0" ? [hybrid] : [] };
      },
    });
    const items = await collect(smartrecruiters.fetch(ctx));
    expect(items).toHaveLength(1);
    expect(ctx.requests.filter((r) => !/\/postings\/[^/]+$/.test(new URL(r.url).pathname) && r.url.includes("Experian"))).toHaveLength(2);
  });

  describe("ritmo e 429", () => {
    const isDetailUrl = (url: string) => /\/postings\/[^/]+$/.test(new URL(url).pathname);

    it("nunca inicia mais de 8 requisições por segundo", async () => {
      vi.useFakeTimers();
      const base = fakeCtx({
        serve: serve({ Experian: { totalFound: 40, items: clone }, BoschGroup: { totalFound: 40, items: clone } }),
      });
      const starts: number[] = [];
      const ctx = {
        ...base,
        fetchJson: (url: string, init?: Parameters<typeof base.fetchJson>[1]) => {
          starts.push(Date.now());
          return base.fetchJson(url, init);
        },
      };
      const done = collect(smartrecruiters.fetch(ctx));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await done).toHaveLength(80);
      expect(starts).toHaveLength(82);
      // Em qualquer janela de 1 s (fechada), no máximo 8 inícios.
      for (let i = 0; i + 8 < starts.length; i++) expect(starts[i + 8]! - starts[i]!).toBeGreaterThanOrEqual(1000);
    });

    /** Servidor de detalhes cujo primeiro pedido de `target` responde 429 `times` vezes. */
    function rateLimited(times: number, retryAfter: string | null) {
      const base = fakeCtx({ serve: serve({ Experian: { totalFound: 1, items: () => hybrid } }) });
      let left = times;
      const calls: { url: string; at: number }[] = [];
      const ctx = {
        ...base,
        fetchJson: async (url: string, init?: Parameters<typeof base.fetchJson>[1]) => {
          calls.push({ url, at: Date.now() });
          const res = await base.fetchJson(url, init);
          if (!isDetailUrl(url) || left === 0) return res;
          left--;
          return { ...res, status: 429, headers: new Headers(retryAfter === null ? {} : { "retry-after": retryAfter }) };
        },
      };
      return { base, ctx, calls };
    }

    it("429 com Retry-After é repetido uma vez, depois da espera, e então sucede", async () => {
      vi.useFakeTimers();
      const { ctx, calls } = rateLimited(1, "2");
      const done = collect(smartrecruiters.fetch({ ...ctx, deadlineAt: Date.now() + 60_000 }));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await done).toHaveLength(1);
      const detail = calls.filter((c) => isDetailUrl(c.url));
      expect(detail).toHaveLength(2);
      expect(detail[1]!.at - detail[0]!.at).toBeGreaterThanOrEqual(2000);
    });

    it("429 duas vezes lança (só uma retentativa)", async () => {
      vi.useFakeTimers();
      const { base, ctx, calls } = rateLimited(2, "1");
      const done = collect(smartrecruiters.fetch({ ...ctx, deadlineAt: Date.now() + 60_000 }));
      const assertion = expect(done).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
      expect(calls.filter((c) => isDetailUrl(c.url))).toHaveLength(2);
      expect(String((base.partials.find((p) => p.label === "Experian")!.error as Error).message)).toContain("429");
    });

    it("429 com Retry-After acima de 2 s ou que não cabe no prazo lança sem esperar", async () => {
      vi.useFakeTimers();
      for (const [retryAfter, window] of [["30", 60_000], ["2", 6_000]] as const) {
        const { ctx, calls } = rateLimited(1, retryAfter);
        const done = collect(smartrecruiters.fetch({ ...ctx, deadlineAt: Date.now() + window }));
        const assertion = expect(done).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(10_000);
        await assertion;
        expect(calls.filter((c) => isDetailUrl(c.url))).toHaveLength(1);
      }
    });
  });

  describe("createLimiter", () => {
    it.each([0, 1, 2, 3, 4, 5])("é estrito quando uma chamada nova chega %i microtarefas depois de uma liberação", async (ticks) => {
      const limit = createLimiter(2);
      let active = 0;
      let peak = 0;
      const gates: (() => void)[] = [];
      const task = () =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise<void>((r) => gates.push(r));
          active--;
        });
      const all = [task(), task(), task()];
      await new Promise((r) => setTimeout(r, 0));
      gates.shift()!();
      for (let i = 0; i < ticks; i++) await Promise.resolve();
      all.push(task());
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 0));
        gates.shift()?.();
      }
      await Promise.all(all);
      expect(peak).toBe(2);
    });
  });
});
