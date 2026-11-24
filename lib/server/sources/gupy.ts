import "server-only";
import { z } from "@/lib/shared/zod";
import { safeUrl } from "@/lib/shared/url";
import type { Seniority, WorkMode } from "@/lib/shared/types/job";
import type { Connector, ConnectorContext, NormalizedJob } from "@/lib/server/sources/types";

/**
 * Busca pública do portal da Gupy (a mesma que portal.gupy.io usa, sem login). Os termos de uso da
 * Gupy não autorizam a coleta; a fonte entrou como exceção aceita pelo mantenedor (docs/fontes.md).
 */
export const GUPY_HOST = "portal.gupy.io";
const API_URL = `https://${GUPY_HOST}/api/job-search/jobs`;
const PAGE_SIZE = 100;
/** A busca para de responder depois de ~500 itens por termo; 5 páginas cobrem o que ela entrega. */
const MAX_PAGES_PER_TERM = 5;

/**
 * Termos buscados em rodízio. A busca casa só o título, então a lista cobre cargos e stacks; o filtro
 * RN-01 (`isTechJob`) descarta o que não for de tecnologia.
 */
export const GUPY_TERMS = [
  "desenvolvedor",
  "programador",
  "engenheiro de software",
  "front-end",
  "frontend",
  "back-end",
  "backend",
  "fullstack",
  "full stack",
  "react",
  "angular",
  "node",
  "java",
  ".net",
  "c#",
  "python",
  "golang",
  "php",
  "kotlin",
  "android",
  "ios",
  "flutter",
  "mobile",
  "engenheiro de dados",
  "data engineer",
  "cientista de dados",
  "analista de dados",
  "dados",
  "devops",
  "sre",
  "cloud",
  "qa",
  "tech lead",
  "arquiteto de software",
  "ux",
  "product manager",
  "segurança da informação",
  "infraestrutura",
  "salesforce",
  "sap",
] as const;

/** Cada termo é relido a cada poucas horas; um dia sem ver a vaga significa que ela saiu do portal. */
const REVISITS_CATALOG_WITHIN_HOURS = 24;

const pageSchema = z.object({
  data: z.array(z.unknown()),
});

export const jobSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  name: z.string().trim().min(1),
  description: z.string().nullish(),
  careerPageName: z.string().nullish(),
  careerPageLogo: z.string().nullish(),
  type: z.string().nullish(),
  publishedDate: z.string().nullish(),
  workplaceType: z.string().nullish(),
  city: z.string().nullish(),
  state: z.string().nullish(),
  jobUrl: z.string().min(1),
});

const WORK_MODE: Record<string, WorkMode> = { remote: "remote", hybrid: "hybrid", "on-site": "onsite" };

/** Tipos de vaga que não são uma vaga aberta de verdade. */
const SKIPPED_TYPES = new Set(["vacancy_type_talent_pool"]);

const SENIORITY_BY_TYPE: Record<string, Seniority> = { vacancy_type_internship: "intern" };

const CONTRACT_TAG: Record<string, string> = {
  vacancy_type_effective: "CLT",
  vacancy_legal_entity: "PJ",
  vacancy_type_internship: "Estágio",
  vacancy_type_temporary: "Temporário",
};

/** O cursor guarda o índice do próximo termo; inválido ou fora da lista recomeça do zero. */
function startIndex(cursor: string | null): number {
  const n = Number(cursor);
  return Number.isInteger(n) && n >= 0 && n < GUPY_TERMS.length ? n : 0;
}

async function* fetchTerms(ctx: ConnectorContext): AsyncGenerator<unknown> {
  const seen = new Set<string>();
  const start = startIndex(ctx.cursor);

  for (let step = 0; step < GUPY_TERMS.length; step++) {
    const index = (start + step) % GUPY_TERMS.length;
    // Sempre lê pelo menos um termo; depois, para no prazo e continua dali na próxima coleta.
    if (step > 0 && Date.now() >= ctx.deadlineAt) {
      ctx.setCursor(String(index));
      return;
    }
    const term = GUPY_TERMS[index]!;
    for (let page = 0; page < MAX_PAGES_PER_TERM; page++) {
      ctx.signal.throwIfAborted();
      const url = new URL(API_URL);
      url.searchParams.set("jobName", term);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", String(page * PAGE_SIZE));
      const res = await ctx.fetchJson(url.toString(), { signal: ctx.signal });
      if (res.status !== 200) throw new Error(`Gupy respondeu ${res.status}`);
      const parsed = pageSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error("Gupy: resposta fora do formato esperado");

      for (const raw of parsed.data.data) {
        const id = (raw as { id?: unknown } | null)?.id;
        if (typeof id !== "string" && typeof id !== "number") continue;
        if (seen.has(String(id))) continue;
        seen.add(String(id));
        yield raw;
      }
      if (parsed.data.data.length < PAGE_SIZE) break;
    }
  }
  // Volta completa na lista: a próxima coleta recomeça do primeiro termo.
  ctx.setCursor(null);
}

/** A Gupy também publica vagas fora do Brasil (ex.: Bogotá); o estado brasileiro confirma o país. */
const BR_STATES = new Set(
  [
    "acre", "alagoas", "amapá", "amazonas", "bahia", "ceará", "distrito federal", "espírito santo", "goiás",
    "maranhão", "mato grosso", "mato grosso do sul", "minas gerais", "pará", "paraíba", "paraná", "pernambuco",
    "piauí", "rio de janeiro", "rio grande do norte", "rio grande do sul", "rondônia", "roraima", "santa catarina",
    "são paulo", "sergipe", "tocantins",
  ],
);

function isGupyJobUrl(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return host === "gupy.io" || host.endsWith(".gupy.io");
}

export const gupy: Connector = {
  id: "gupy",
  // O país vem por vaga (estado brasileiro → BR). Marcar a fonte como brasileira tornaria
  // "nacional" também as vagas de fora do Brasil que a Gupy publica.
  brazilian: false,
  fullSnapshot: false,
  minIntervalMinutes: 60,
  revisitsCatalogWithinHours: REVISITS_CATALOG_WITHIN_HOURS,
  allowedHosts: [GUPY_HOST],
  attribution: { label: "Gupy", url: "https://portal.gupy.io", dofollow: false },
  fetch: fetchTerms,
  normalize(raw): NormalizedJob | null {
    const parsed = jobSchema.safeParse(raw);
    if (!parsed.success) return null;
    const j = parsed.data;
    if (j.type && SKIPPED_TYPES.has(j.type)) return null;
    const url = safeUrl(j.jobUrl);
    if (!url || !isGupyJobUrl(url)) return null;

    const city = j.city?.trim() || null;
    const state = j.state?.trim() || null;
    const workModeHint = WORK_MODE[(j.workplaceType ?? "").toLowerCase()] ?? null;
    const place = [city, state].filter(Boolean).join(", ");
    // Sem cidade nem estado é vaga remota do portal brasileiro; com local, só o estado confirma o Brasil.
    const brazil = state ? BR_STATES.has(state.toLowerCase()) : !city;
    const published = j.publishedDate ? new Date(j.publishedDate) : null;
    const contract = j.type ? CONTRACT_TAG[j.type] : undefined;
    return {
      externalId: j.id,
      url,
      title: j.name,
      company: j.careerPageName?.trim() || new URL(url).hostname.split(".")[0]!,
      companyLogoUrl: j.careerPageLogo ? safeUrl(j.careerPageLogo) : null,
      descriptionHtml: j.description ?? "",
      descriptionFormat: "html",
      country: brazil ? "BR" : null,
      city,
      locationText: !place ? (brazil ? "Brasil" : null) : brazil ? `${place}, Brasil` : place,
      // Regiões por extenso, como o `parseLocation` gera; só fazem sentido em vaga remota.
      eligibleRegions: workModeHint === "remote" && brazil ? ["Brazil"] : [],
      workModeHint,
      seniorityHint: (j.type && SENIORITY_BY_TYPE[j.type]) || null,
      tags: contract ? [contract] : [],
      salary: null,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
    };
  },
};
