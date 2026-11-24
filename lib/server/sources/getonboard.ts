import "server-only";
import { z } from "@/lib/shared/zod";
import { safeUrl } from "@/lib/shared/url";
import type { Seniority, WorkMode } from "@/lib/shared/types/job";
import { fetchBoardsPooled } from "@/lib/server/sources/boards";
import { countryCodeFromName } from "@/lib/server/sources/location";
import type { Connector, ConnectorContext, NormalizedJob } from "@/lib/server/sources/types";

/** Host fixo da API: o fetch seguro só aceita URLs base definidas no código. */
export const GETONBOARD_HOST = "www.getonbrd.com";

/** Categorias de tecnologia consultadas; cada uma é um "board" do rodízio. */
export const GETONBOARD_CATEGORIES = [
  "programming",
  "sysadmin-devops-qa",
  "data-science-analytics",
  "machine-learning-ai",
  "design-ux",
  "cybersecurity",
  "mobile-developer",
] as const;

const PAGE_SIZE = 100;
/** Teto de páginas por categoria (a maior, programação, tem cerca de 3). */
const MAX_PAGES_PER_CATEGORY = 10;

const pageSchema = z.object({ data: z.array(z.unknown()) });

const MODALITIES = ["fully_remote", "remote_local", "hybrid", "no_remote"] as const;

export const jobSchema = z.object({
  /** Categoria consultada, acrescentada pelo conector ao devolver cada vaga. */
  category: z.string().min(1),
  id: z.string().min(1),
  links: z.object({ public_url: z.string().min(1) }),
  attributes: z.object({
    title: z.string().trim().min(1),
    description: z.string().nullish(),
    description_headline: z.string().nullish(),
    projects: z.string().nullish(),
    functions: z.string().nullish(),
    functions_headline: z.string().nullish(),
    desirable: z.string().nullish(),
    desirable_headline: z.string().nullish(),
    benefits: z.string().nullish(),
    benefits_headline: z.string().nullish(),
    remote_modality: z.enum(MODALITIES),
    countries: z.array(z.string()).nullish(),
    min_salary: z.number().nullish(),
    max_salary: z.number().nullish(),
    /** Epoch em segundos. */
    published_at: z.number().nullish(),
    seniority: z.object({ data: z.object({ id: z.number() }).nullish() }).nullish(),
    tags: z.object({ data: z.array(z.object({ attributes: z.object({ name: z.string() }) })) }).nullish(),
    company: z
      .object({
        data: z
          .object({ attributes: z.object({ name: z.string().trim().min(1), logo: z.string().nullish() }) })
          .nullish(),
      })
      .nullish(),
  }),
});

// --- coleta -----------------------------------------------------------------------------------

async function fetchCategory(ctx: ConnectorContext, category: string): Promise<unknown[]> {
  const jobs: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES_PER_CATEGORY; page++) {
    const url = new URL(`https://${GETONBOARD_HOST}/api/v0/categories/${category}/jobs`);
    url.searchParams.set("per_page", String(PAGE_SIZE));
    url.searchParams.set("page", String(page));
    // Sem expand, empresa e tags chegam só como ids.
    url.searchParams.set("expand", JSON.stringify(["company", "tags"]));
    const res = await ctx.fetchJson(url.toString(), { signal: ctx.signal });
    if (res.status !== 200) throw new Error(`Get on Board ${category} respondeu ${res.status}`);
    const parsed = pageSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error(`Get on Board ${category}: resposta fora do formato esperado`);
    for (const job of parsed.data.data) {
      jobs.push(typeof job === "object" && job !== null ? { ...(job as Record<string, unknown>), category } : job);
    }
    if (parsed.data.data.length < PAGE_SIZE) return jobs;
  }
  // Lista truncada: devolvê-la no escopo expiraria por engano as vagas além do teto (snapshot completo).
  throw new Error(`Get on Board ${category}: mais de ${MAX_PAGES_PER_CATEGORY} páginas, lista incompleta`);
}

function fetchCategories(ctx: ConnectorContext): AsyncGenerator<unknown> {
  return fetchBoardsPooled(ctx, "Get on Board", GETONBOARD_CATEGORIES, (category) => fetchCategory(ctx, category));
}

// --- normalização -----------------------------------------------------------------------------

const WORK_MODE: Record<(typeof MODALITIES)[number], WorkMode> = {
  fully_remote: "remote",
  remote_local: "remote",
  hybrid: "hybrid",
  no_remote: "onsite",
};

/** Ids da API: 1 sem experiência, 2 júnior, 3 semi sênior, 4 sênior, 5 especialista. */
const SENIORITY: Record<number, Seniority> = { 1: "junior", 2: "junior", 3: "mid", 4: "senior", 5: "lead" };

/** A API escreve "Brasil" em português, ao contrário dos demais países (em inglês). */
const isBrazil = (name: string) => /^(brasil|brazil)$/i.test(name.trim());

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function buildDescription(a: z.infer<typeof jobSchema>["attributes"]): string {
  const section = (headline: string | null | undefined, body: string | null | undefined) =>
    body?.trim() ? `${headline?.trim() ? `<h3>${escapeHtml(headline.trim())}</h3>` : ""}${body}` : "";
  return [
    a.projects?.trim() ?? "",
    section(a.functions_headline, a.functions),
    section(a.description_headline, a.description),
    section(a.desirable_headline, a.desirable),
    section(a.benefits_headline, a.benefits),
  ]
    .filter(Boolean)
    .join("\n");
}

export const getonboard: Connector = {
  id: "getonboard",
  brazilian: false,
  fullSnapshot: true,
  minIntervalMinutes: 60,
  allowedHosts: [GETONBOARD_HOST],
  attribution: { label: "Get on Board", url: "https://www.getonbrd.com", dofollow: false },
  fetch: fetchCategories,
  normalize(raw): NormalizedJob | null {
    const parsed = jobSchema.safeParse(raw);
    if (!parsed.success) return null;
    const j = parsed.data;
    const a = j.attributes;
    const url = safeUrl(j.links.public_url);
    const company = a.company?.data?.attributes;
    if (!url || !company) return null;

    const places = (a.countries ?? []).map((c) => c.trim()).filter((c) => c && c.toLowerCase() !== "remote");
    const brazil = places.some(isBrazil);
    const workMode = WORK_MODE[a.remote_modality];
    // Presencial ou híbrida só interessa quando inclui o Brasil.
    if (workMode !== "remote" && !brazil) return null;

    const min = a.min_salary && a.min_salary > 0 ? a.min_salary : null;
    const max = a.max_salary && a.max_salary > 0 ? a.max_salary : null;
    const seniorityId = a.seniority?.data?.id;
    return {
      externalId: `${j.category}:${j.id}`,
      url,
      title: a.title,
      company: company.name,
      companyLogoUrl: company.logo ? safeUrl(company.logo) : null,
      descriptionHtml: buildDescription(a),
      descriptionFormat: "html",
      country: brazil ? "BR" : places.length === 1 ? countryCodeFromName(places[0]) : null,
      city: null,
      locationText: places.length > 0 ? places.join(", ") : workMode === "remote" ? "Remote" : null,
      // Remota "fully_remote" não tem restrição de país; "remote_local" depende de regras que a API não traz.
      eligibleRegions: a.remote_modality === "fully_remote" ? ["Worldwide"] : [],
      workModeHint: workMode,
      seniorityHint: seniorityId === undefined ? null : (SENIORITY[seniorityId] ?? null),
      tags: (a.tags?.data ?? []).map((t) => t.attributes.name.trim()).filter(Boolean),
      // O payload não traz moeda nem período; o site exibe valores em USD por mês.
      salary: min === null && max === null ? null : { min, max, currency: "USD", period: "month" },
      publishedAt: a.published_at ? new Date(a.published_at * 1000) : null,
    };
  },
};
