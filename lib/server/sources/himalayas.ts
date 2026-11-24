import "server-only";
import { z } from "zod";
import { safeUrl } from "@/lib/shared/url";
import type { Seniority } from "@/lib/shared/types/job";
import type { Connector, ConnectorContext, NormalizedJob } from "@/lib/server/sources/types";

/** Host fixo da API (D-07): o fetch seguro só aceita URLs base definidas no código. */
export const HIMALAYAS_HOST = "himalayas.app";
const API_URL = `https://${HIMALAYAS_HOST}/jobs/api`;
const PAGE_SIZE = 20;
/** Teto de páginas por coleta (500 vagas); o limite da API gratuita é de 60 req/min. */
const MAX_PAGES = 25;

const pageSchema = z.object({
  nextCursor: z.string().nullish(),
  jobs: z.array(z.unknown()),
});

const jobSchema = z.object({
  guid: z.string().min(1),
  title: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  companyLogo: z.string().nullish(),
  description: z.string(),
  applicationLink: z.string().min(1),
  pubDate: z.number().nullish(),
  categories: z.array(z.string()).nullish(),
  parentCategories: z.array(z.string()).nullish(),
  seniority: z.array(z.string()).nullish(),
  locationRestrictions: z.array(z.string()).nullish(),
  minSalary: z.number().nullish(),
  maxSalary: z.number().nullish(),
  currency: z.string().nullish(),
  salaryPeriod: z.string().nullish(),
});

const SENIORITY: Record<string, Seniority> = {
  intern: "intern",
  "entry-level": "junior",
  "mid-level": "mid",
  senior: "senior",
};

const SALARY_PERIOD = { annual: "year", monthly: "month", hourly: "hour" } as const;

function mapSalary(j: z.infer<typeof jobSchema>): NormalizedJob["salary"] {
  const period = SALARY_PERIOD[(j.salaryPeriod ?? "").toLowerCase() as keyof typeof SALARY_PERIOD];
  const min = j.minSalary && j.minSalary > 0 ? j.minSalary : null;
  const max = j.maxSalary && j.maxSalary > 0 ? j.maxSalary : null;
  if (!period || !j.currency || (min === null && max === null)) return null;
  return { min, max, currency: j.currency.toUpperCase(), period };
}

async function* fetchPages(ctx: ConnectorContext): AsyncGenerator<unknown> {
  const key = process.env.HIMALAYAS_API_KEY;
  const headers = key ? { Authorization: `Bearer ${key}` } : undefined;
  let newest: string | null = null;
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(API_URL);
    url.searchParams.set("limit", String(PAGE_SIZE));
    if (cursor) url.searchParams.set("cursor", cursor);

    const res = await ctx.fetchJson(url.toString(), { headers, signal: ctx.signal });
    if (res.status !== 200) throw new Error(`Himalayas respondeu ${res.status}`);
    const parsed = pageSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error("Himalayas: resposta fora do formato esperado");

    for (const raw of parsed.data.jobs) {
      const guid = (raw as { guid?: unknown } | null)?.guid;
      if (typeof guid !== "string") continue;
      // Itens vêm do mais novo para o mais antigo: o guid salvo marca onde a coleta anterior parou.
      if (guid === ctx.cursor) {
        if (newest) ctx.setCursor(newest);
        return;
      }
      newest ??= guid;
      yield raw;
    }

    cursor = parsed.data.nextCursor ?? null;
    if (!cursor || parsed.data.jobs.length === 0) break;
  }
  if (newest) ctx.setCursor(newest);
}

export const himalayas: Connector = {
  id: "himalayas",
  brazilian: false,
  fullSnapshot: false,
  minIntervalMinutes: 60,
  allowedHosts: [HIMALAYAS_HOST],
  attribution: { label: "Himalayas", url: `https://${HIMALAYAS_HOST}`, dofollow: false },
  fetch: fetchPages,
  normalize(raw) {
    const parsed = jobSchema.safeParse(raw);
    if (!parsed.success) return null;
    const j = parsed.data;
    // O applicationLink precisa seguir intacto (D-07); se não for uma URL válida, a vaga é descartada.
    if (!safeUrl(j.applicationLink)) return null;

    const regions = j.locationRestrictions ?? [];
    const seniorityHint =
      (j.seniority ?? []).map((s) => SENIORITY[s.toLowerCase()]).find((s) => s !== undefined) ?? null;
    return {
      externalId: j.guid,
      url: j.applicationLink,
      title: j.title,
      company: j.companyName,
      companyLogoUrl: j.companyLogo ? safeUrl(j.companyLogo) : null,
      descriptionHtml: j.description,
      descriptionFormat: "html",
      country: null,
      city: null,
      locationText: regions.length > 0 ? regions.join(", ") : null,
      eligibleRegions: regions,
      workModeHint: "remote",
      seniorityHint,
      tags: [...(j.categories ?? []), ...(j.parentCategories ?? [])].map((t) => t.replace(/-/g, " ")),
      salary: mapSalary(j),
      publishedAt: j.pubDate ? new Date(j.pubDate * 1000) : null,
    };
  },
};
