import "server-only";
import { z } from "zod";
import { safeUrl } from "@/lib/shared/url";
import type { Seniority } from "@/lib/shared/types/job";
import type { Connector, ConnectorContext, NormalizedJob } from "@/lib/server/sources/types";
import { countryCodeFromName } from "@/lib/server/sources/location";

/** Host fixo da API (D-07): o fetch seguro só aceita URLs base definidas no código. */
export const JOBICY_HOST = "jobicy.com";
const API_URL = `https://${JOBICY_HOST}/api/v2/remote-jobs`;
const GEOS = ["brazil", "latam"] as const;
const PAGE_SIZE = 50;

const feedSchema = z.object({ jobs: z.array(z.unknown()) });

const jobSchema = z.object({
  id: z.union([z.string().min(1), z.number()]),
  url: z.string().min(1),
  jobTitle: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  companyLogo: z.string().nullish(),
  jobIndustry: z.array(z.string()).nullish(),
  jobGeo: z.string().nullish(),
  jobLevel: z.string().nullish(),
  jobDescription: z.string().nullish(),
  pubDate: z.string().nullish(),
  salaryMin: z.number().nullish(),
  salaryMax: z.number().nullish(),
  salaryCurrency: z.string().nullish(),
  salaryPeriod: z.string().nullish(),
});

const SENIORITY: [RegExp, Seniority][] = [
  [/intern/i, "intern"],
  [/junior|entry/i, "junior"],
  [/mid/i, "mid"],
  [/senior/i, "senior"],
  [/director|lead|manager/i, "lead"],
];

const SALARY_PERIOD = { yearly: "year", annual: "year", monthly: "month", hourly: "hour" } as const;

function mapSalary(j: z.infer<typeof jobSchema>): NormalizedJob["salary"] {
  const period = SALARY_PERIOD[(j.salaryPeriod ?? "yearly").toLowerCase() as keyof typeof SALARY_PERIOD];
  const min = j.salaryMin && j.salaryMin > 0 ? j.salaryMin : null;
  const max = j.salaryMax && j.salaryMax > 0 ? j.salaryMax : null;
  const currency = j.salaryCurrency?.trim().toUpperCase();
  if (!period || !currency || (min === null && max === null)) return null;
  return { min, max, currency, period };
}

async function fetchGeo(ctx: ConnectorContext, geo: string): Promise<unknown[]> {
  const url = new URL(API_URL);
  url.searchParams.set("count", String(PAGE_SIZE));
  url.searchParams.set("geo", geo);
  url.searchParams.set("industry", "engineering");
  const res = await ctx.fetchJson(url.toString(), { signal: ctx.signal });
  if (res.status !== 200) throw new Error(`Jobicy (${geo}) respondeu ${res.status}`);
  const parsed = feedSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`Jobicy (${geo}): resposta fora do formato esperado`);
  return parsed.data.jobs;
}

/** As duas consultas se sobrepõem: cada id sai uma vez; se só uma falha, vale a outra. */
async function* fetchFeeds(ctx: ConnectorContext): AsyncGenerator<unknown> {
  const seen = new Set<string>();
  const errors: unknown[] = [];
  for (const geo of GEOS) {
    ctx.signal.throwIfAborted();
    let jobs: unknown[];
    try {
      jobs = await fetchGeo(ctx, geo);
    } catch (err) {
      if (ctx.signal.aborted) throw err;
      errors.push(err);
      continue;
    }
    for (const raw of jobs) {
      const id = (raw as { id?: unknown } | null)?.id;
      if (typeof id !== "string" && typeof id !== "number") {
        yield raw;
        continue;
      }
      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      yield raw;
    }
  }
  if (errors.length === GEOS.length) throw errors[0];
}

export const jobicy: Connector = {
  id: "jobicy",
  brazilian: false,
  fullSnapshot: false,
  minIntervalMinutes: 60,
  attribution: { label: "Jobicy", url: `https://${JOBICY_HOST}`, dofollow: false },
  fetch: fetchFeeds,
  normalize(raw) {
    const parsed = jobSchema.safeParse(raw);
    if (!parsed.success) return null;
    const j = parsed.data;
    // D-07: o link da vaga é a página do Jobicy, nunca o link de candidatura do empregador.
    const url = safeUrl(j.url);
    if (!url || new URL(url).hostname !== JOBICY_HOST) return null;

    const regions = (j.jobGeo ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => (r.toLowerCase() === "anywhere" ? "Worldwide" : r));
    const publishedAt = j.pubDate ? new Date(j.pubDate) : null;
    return {
      externalId: String(j.id),
      url,
      title: j.jobTitle,
      company: j.companyName,
      companyLogoUrl: j.companyLogo ? safeUrl(j.companyLogo) : null,
      descriptionHtml: j.jobDescription ?? "",
      descriptionFormat: "html",
      country: regions.length === 1 ? countryCodeFromName(regions[0]) : null,
      city: null,
      locationText: regions.length > 0 ? regions.join(", ") : null,
      eligibleRegions: regions,
      workModeHint: "remote",
      seniorityHint: SENIORITY.find(([re]) => re.test(j.jobLevel ?? ""))?.[1] ?? null,
      tags: (j.jobIndustry ?? []).map((t) => t.trim()).filter(Boolean),
      salary: mapSalary(j),
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
    };
  },
};
