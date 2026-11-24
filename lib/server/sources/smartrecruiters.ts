import "server-only";
import { z } from "@/lib/shared/zod";
import { safeUrl } from "@/lib/shared/url";
import type { Seniority, WorkMode } from "@/lib/shared/types/job";
import { DEADLINE_MARGIN_MS, fetchBoardsPooled } from "@/lib/server/sources/boards";
import { SMARTRECRUITERS_BOARDS } from "@/lib/server/sources/boards/smartrecruiters";
import { countryNameFromCode } from "@/lib/server/sources/location";
import type { Connector, ConnectorContext, NormalizedJob, SafeResponse } from "@/lib/server/sources/types";

/** Host fixo da API (D-07): o fetch seguro só aceita URLs base definidas no código. */
export const SMARTRECRUITERS_HOST = "api.smartrecruiters.com";

/** Empresas curadas (D-05): a lista fica em `boards/smartrecruiters.ts`; nada além dela é consultado. */
export { SMARTRECRUITERS_BOARDS };

const PAGE_SIZE = 100;
/** Teto de páginas por empresa (2.000 vagas no Brasil; as maiores têm cerca de 200). */
const MAX_PAGES_PER_BOARD = 20;
/** Requisições de detalhe simultâneas em toda a coleta (limite da API: 8). */
const DETAIL_CONCURRENCY = 6;
/** Espaçamento mínimo entre inícios de requisição (lista e detalhe): cerca de 8 por segundo, abaixo do limite de 10. */
const MIN_REQUEST_GAP_MS = 125;
/** Maior espera aceita de `Retry-After` num 429; acima disso (ou sem caber no prazo) a requisição falha. */
const MAX_RETRY_AFTER_MS = 2_000;
/** Sem `Retry-After`, espera 1 s antes da única retentativa. */
const DEFAULT_RETRY_AFTER_MS = 1_000;
/** Só a função de tecnologia busca o detalhe: poupa uma requisição por vaga que o filtro RN-01 descartaria. */
const TECH_FUNCTION_ID = "information_technology";

const pageSchema = z.object({ totalFound: z.number(), content: z.array(z.unknown()) });

const listItemSchema = z.object({
  /** Id da empresa, acrescentado pelo conector ao devolver cada vaga. */
  board: z.string().min(1),
  id: z.string().min(1),
  name: z.string().trim().min(1),
  releasedDate: z.string().nullish(),
  company: z.object({ name: z.string().nullish() }).nullish(),
  location: z
    .object({
      city: z.string().nullish(),
      region: z.string().nullish(),
      country: z.string().nullish(),
      remote: z.boolean().nullish(),
      hybrid: z.boolean().nullish(),
    })
    .nullish(),
  function: z.object({ id: z.string().nullish() }).nullish(),
  department: z.object({ label: z.string().nullish() }).nullish(),
  experienceLevel: z.object({ id: z.string().nullish() }).nullish(),
});

const section = z.object({ text: z.string().nullish() }).nullish();
const detailSchema = z.object({
  postingUrl: z.string().min(1),
  jobAd: z.object({
    sections: z.object({
      companyDescription: section,
      jobDescription: section,
      qualifications: section,
      additionalInformation: section,
    }),
  }),
});

export const jobSchema = listItemSchema.extend({ detail: detailSchema });

// --- coleta -----------------------------------------------------------------------------------

type Get = (url: string) => Promise<SafeResponse>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * GET com espaçamento mínimo entre inícios (compartilhado entre todas as empresas da coleta) e uma única
 * retentativa em 429, esperando o `Retry-After` (até 2 s, sem passar do prazo da fonte); o segundo 429 volta ao chamador.
 */
function createGet(ctx: ConnectorContext): Get {
  let nextStart = 0;
  const paced = async (url: string) => {
    const at = Math.max(Date.now(), nextStart);
    nextStart = at + MIN_REQUEST_GAP_MS;
    if (at > Date.now()) await sleep(at - Date.now());
    return ctx.fetchJson(url, { signal: ctx.signal });
  };
  return async (url) => {
    const res = await paced(url);
    if (res.status !== 429) return res;
    const header = Number(res.headers.get("retry-after"));
    const wait = res.headers.get("retry-after") !== null && Number.isFinite(header) ? header * 1000 : DEFAULT_RETRY_AFTER_MS;
    if (wait > MAX_RETRY_AFTER_MS || Date.now() + wait >= ctx.deadlineAt - DEADLINE_MARGIN_MS) {
      throw new Error(`SmartRecruiters respondeu 429 e a espera de ${wait} ms não cabe`);
    }
    // A espera também reserva o espaçamento: ninguém inicia requisição antes dela terminar.
    nextStart = Math.max(nextStart, Date.now() + wait);
    return paced(url);
  };
}

async function fetchList(get: Get, company: string): Promise<{ id: string }[]> {
  const items: { id: string }[] = [];
  for (let page = 0; page < MAX_PAGES_PER_BOARD; page++) {
    const offset = page * PAGE_SIZE;
    const url = new URL(`https://${SMARTRECRUITERS_HOST}/v1/companies/${encodeURIComponent(company)}/postings`);
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("country", "br");
    const res = await get(url.toString());
    if (res.status !== 200) throw new Error(`SmartRecruiters ${company} respondeu ${res.status}`);
    const parsed = pageSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error(`SmartRecruiters ${company}: resposta fora do formato esperado`);
    // A API devolve 200 com totalFound 0 para id inexistente (e para empresa sem vagas no Brasil).
    if (page === 0 && parsed.data.totalFound === 0) {
      throw new Error(`SmartRecruiters ${company}: nenhuma vaga no Brasil (id inválido?)`);
    }
    for (const item of parsed.data.content) {
      if (typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string") {
        items.push(item as { id: string });
      }
    }
    if (offset + PAGE_SIZE >= parsed.data.totalFound || parsed.data.content.length === 0) return items;
  }
  // Lista truncada: devolvê-la no escopo expiraria por engano as vagas além do teto (snapshot completo).
  throw new Error(`SmartRecruiters ${company}: mais de ${MAX_PAGES_PER_BOARD} páginas, lista incompleta`);
}

/** Limita as requisições de detalhe em andamento: a API aceita 8 simultâneas por IP, e o rodízio abre até 5 empresas. */
export function createLimiter(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    // Entrada com vaga livre ocupa o slot na hora; sem vaga, espera o repasse do slot por quem termina.
    if (active < max) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      // Repassa o slot ao próximo da fila sem liberá-lo: uma chamada nova não consegue entrar no intervalo.
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
type Limiter = ReturnType<typeof createLimiter>;

async function fetchCompany(ctx: ConnectorContext, get: Get, limit: Limiter, company: string): Promise<unknown[]> {
  const listed = await fetchList(get, company);
  const tech = listed.filter((item) => (item as { function?: { id?: string } }).function?.id === TECH_FUNCTION_ID);
  let failed: unknown = null;
  const details = await Promise.all(
    tech.map((item) =>
      limit(async () => {
        // Já falhou (ou o prazo acabou): não gasta mais requisições. Detalhes pela metade seriam um snapshot incompleto.
        if (failed) return null;
        try {
          if (Date.now() >= ctx.deadlineAt - DEADLINE_MARGIN_MS) {
            throw new Error(`SmartRecruiters ${company}: prazo da fonte esgotado ao buscar detalhes`);
          }
          const url = `https://${SMARTRECRUITERS_HOST}/v1/companies/${encodeURIComponent(company)}/postings/${encodeURIComponent(item.id)}`;
          const res = await get(url);
          // Vaga fechada entre a lista e o detalhe.
          if (res.status === 404) return null;
          if (res.status !== 200) throw new Error(`SmartRecruiters ${company}/${item.id} respondeu ${res.status}`);
          return { ...item, board: company, detail: await res.json() };
        } catch (error) {
          failed ??= error;
          throw error;
        }
      }),
    ),
  );
  return details.filter((d) => d !== null);
}

function fetchCompanies(ctx: ConnectorContext): AsyncGenerator<unknown> {
  const limit = createLimiter(DETAIL_CONCURRENCY);
  const get = createGet(ctx);
  return fetchBoardsPooled(ctx, "SmartRecruiters", SMARTRECRUITERS_BOARDS, (company) => fetchCompany(ctx, get, limit, company));
}

// --- normalização -----------------------------------------------------------------------------

/** `experienceLevel.id` da API; os demais valores (não aplicável, sênior, diretoria) ficam para o título. */
const SENIORITY: Record<string, Seniority> = { internship: "intern", entry_level: "junior", associate: "mid" };

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const escapeHtml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const smartrecruiters: Connector = {
  id: "smartrecruiters",
  brazilian: false,
  fullSnapshot: true,
  minIntervalMinutes: 60,
  allowedHosts: [SMARTRECRUITERS_HOST],
  attribution: { label: "SmartRecruiters", url: "https://www.smartrecruiters.com", dofollow: false },
  fetch: fetchCompanies,
  normalize(raw): NormalizedJob | null {
    const parsed = jobSchema.safeParse(raw);
    if (!parsed.success) return null;
    const j = parsed.data;
    const url = safeUrl(j.detail.postingUrl);
    if (!url) return null;

    const loc = j.location;
    const country = loc?.country?.trim().toUpperCase() || null;
    const city = loc?.city?.trim() || null;
    const place = [city, loc?.region?.trim(), countryNameFromCode(country) ?? country].filter(Boolean);
    const workMode: WorkMode = loc?.remote ? "remote" : loc?.hybrid ? "hybrid" : "onsite";
    const s = j.detail.jobAd.sections;
    const department = j.department?.label?.trim();
    const level = j.experienceLevel?.id;

    return {
      externalId: `${j.board}:${j.id}`,
      url,
      title: j.name,
      company: j.company?.name?.trim() || j.board,
      companyLogoUrl: null,
      // A descrição da empresa é texto institucional repetido em todas as vagas: fica de fora. Sem nenhuma
      // seção da vaga, o título evita uma descrição vazia.
      descriptionHtml:
        [s.jobDescription?.text, s.qualifications?.text, s.additionalInformation?.text]
          .map((t) => t?.trim() ?? "")
          .filter(Boolean)
          .join("\n") || `<p>${escapeHtml(j.name)}</p>`,
      descriptionFormat: "html",
      country,
      city,
      locationText: place.length > 0 ? place.join(", ") : null,
      eligibleRegions: [],
      workModeHint: workMode,
      seniorityHint: level ? (SENIORITY[level] ?? null) : null,
      tags: department ? [department] : [],
      salary: null,
      publishedAt: toDate(j.releasedDate),
    };
  },
};
