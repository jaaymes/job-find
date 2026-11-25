import "server-only";
import { z } from "@/lib/shared/zod";
import { safeUrl } from "@/lib/shared/url";
import type { Seniority } from "@/lib/shared/types/job";
import type { Connector, ConnectorContext, NormalizedJob } from "@/lib/server/sources/types";
import { countryNameFromCode } from "@/lib/server/sources/location";
import { decodeEntities } from "@/lib/server/sources/text";

/** Host fixo da API (D-02): o fetch seguro só aceita URLs base definidas no código. */
export const REMOTEJOBS_HOST = "remotejobs.org";
const API_URL = `https://${REMOTEJOBS_HOST}/api/v1/jobs`;
const PAGE_SIZE = 50;
const MAX_PAGES = 30;
/** Folga antes do prazo da fonte para não começar uma página que não termina a tempo. */
const DEADLINE_MARGIN_MS = 5_000;

const pageSchema = z.object({
  data: z.array(z.unknown()),
  pagination: z.object({ has_more: z.boolean() }),
});

export const jobSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  url: z.string().min(1),
  company: z.object({
    name: z.string().trim().min(1),
    logo_url: z.string().nullish(),
  }),
  category: z.object({ name: z.string().nullish(), slug: z.string().nullish() }).nullish(),
  location: z.string().nullish(),
  location_normalization: z
    .object({
      work_arrangement: z.string().nullish(),
      scope: z.string().nullish(),
      allowed_countries: z.array(z.string()).nullish(),
      worksite_countries: z.array(z.string()).nullish(),
    })
    .nullish(),
  salary_min: z.number().nullish(),
  salary_max: z.number().nullish(),
  salary_currency: z.string().nullish(),
  salary_period: z.string().nullish(),
  search_facts: z
    .object({
      seniority: z.string().nullish(),
      required_skills: z.array(z.string()).nullish(),
    })
    .nullish(),
  description: z.string().nullish(),
  posted_at: z.string().nullish(),
});

type RemoteJob = z.infer<typeof jobSchema>;

const WORK_MODE = { remote: "remote", hybrid: "hybrid", onsite: "onsite" } as const;

const SENIORITY: [RegExp, Seniority][] = [
  [/intern/i, "intern"],
  [/junior|entry/i, "junior"],
  [/mid/i, "mid"],
  [/senior|staff/i, "senior"],
  [/lead|manager|director|principal|head/i, "lead"],
];

const SALARY_PERIOD = { hour: "hour", month: "month", year: "year" } as const;

function mapSalary(j: RemoteJob): NormalizedJob["salary"] {
  const period = SALARY_PERIOD[(j.salary_period ?? "").toLowerCase() as keyof typeof SALARY_PERIOD];
  const min = j.salary_min && j.salary_min > 0 ? j.salary_min : null;
  const max = j.salary_max && j.salary_max > 0 ? j.salary_max : null;
  const currency = j.salary_currency?.trim().toUpperCase();
  if (!period || !currency || (min === null && max === null)) return null;
  return { min, max, currency, period };
}

/** Pagina `country=BR` por `offset` até `has_more` ser falso; ids repetidos na virada de página saem uma vez. */
async function* fetchPages(ctx: ConnectorContext): AsyncGenerator<unknown> {
  const seen = new Set<string>();
  for (let page = 0; page < MAX_PAGES; page++) {
    if (Date.now() >= ctx.deadlineAt - DEADLINE_MARGIN_MS) {
      ctx.reportPartial("remotejobs", new Error("prazo da fonte esgotado"));
      return;
    }
    ctx.signal.throwIfAborted();
    const url = new URL(API_URL);
    url.searchParams.set("country", "BR");
    url.searchParams.set("sort", "recent");
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("offset", String(page * PAGE_SIZE));
    const res = await ctx.fetchJson(url.toString(), { signal: ctx.signal });
    if (res.status !== 200) throw new Error(`RemoteJobs.org respondeu ${res.status}`);
    const parsed = pageSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error("RemoteJobs.org: resposta fora do formato esperado");
    for (const raw of parsed.data.data) {
      const id = (raw as { id?: unknown } | null)?.id;
      if (typeof id === "string") {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      yield raw;
    }
    if (!parsed.data.pagination.has_more) return;
    // Página vazia com has_more: a lista ficou incompleta, então não pode valer como snapshot.
    if (parsed.data.data.length === 0) {
      ctx.reportPartial("remotejobs", new Error("página vazia com has_more"));
      return;
    }
    if (page === MAX_PAGES - 1) ctx.reportPartial("remotejobs", new Error("teto de 30 páginas atingido"));
  }
}

export const remotejobs: Connector = {
  id: "remotejobs",
  brazilian: false,
  fullSnapshot: true,
  minIntervalMinutes: 60,
  allowedHosts: [REMOTEJOBS_HOST],
  attribution: { label: "RemoteJobs.org", url: `https://${REMOTEJOBS_HOST}`, dofollow: false },
  fetch: fetchPages,
  normalize(raw) {
    const parsed = jobSchema.safeParse(raw);
    if (!parsed.success) return null;
    const j = parsed.data;
    // D-02: o link da vaga é a página do RemoteJobs.org, intacto (exigência dos termos).
    const url = safeUrl(j.url);
    if (!url || new URL(url).hostname !== REMOTEJOBS_HOST) return null;

    const loc = j.location_normalization;
    const arrangement = (loc?.work_arrangement ?? "").toLowerCase();
    const workModeHint = WORK_MODE[arrangement as keyof typeof WORK_MODE] ?? null;
    const worksite = (loc?.worksite_countries ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean);
    // Defesa: presencial/híbrida só interessa se o local de trabalho incluir o Brasil.
    if ((workModeHint === "onsite" || workModeHint === "hybrid") && !worksite.includes("BR")) return null;

    const regions =
      loc?.scope === "worldwide"
        ? ["Worldwide"]
        : (loc?.allowed_countries ?? []).map((c) => countryNameFromCode(c) ?? c.trim().toUpperCase()).filter(Boolean);
    const publishedAt = j.posted_at ? new Date(j.posted_at) : null;
    const tags = [j.category?.name, ...(j.search_facts?.required_skills ?? [])]
      .map((t) => t?.trim())
      .filter((t): t is string => !!t);
    return {
      externalId: j.id,
      url,
      title: decodeEntities(j.title),
      company: decodeEntities(j.company.name),
      companyLogoUrl: j.company.logo_url ? safeUrl(j.company.logo_url) : null,
      descriptionHtml: j.description ?? "",
      descriptionFormat: "html",
      country: worksite.length === 1 ? worksite[0]! : null,
      city: null,
      locationText: j.location?.trim() || null,
      eligibleRegions: regions,
      workModeHint,
      seniorityHint: SENIORITY.find(([re]) => re.test(j.search_facts?.seniority ?? ""))?.[1] ?? null,
      tags,
      salary: mapSalary(j),
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
    };
  },
};
