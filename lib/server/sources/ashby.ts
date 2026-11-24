import "server-only";
import { z } from "@/lib/shared/zod";
import { fetchBoardsPooled } from "@/lib/server/sources/boards";
import { countryCodeFromName, parseLocation } from "@/lib/server/sources/location";
import { safeUrl } from "@/lib/shared/url";
import type { WorkMode } from "@/lib/shared/types/job";
import type { Connector, ConnectorContext, NormalizedJob } from "@/lib/server/sources/types";

/** Host fixo da API (D-07): o fetch seguro só aceita URLs base definidas no código. */
export const ASHBY_HOST = "api.ashbyhq.com";

/** Boards curados da D-07 (nada além desta lista é consultado). */
export const ASHBY_BOARDS = [
  "nubank", "supabase", "posthog", "linear", "sanity", "replit", "vanta", "plaid", "ramp", "notion", "cohere",
] as const;

const boardSchema = z.object({ jobs: z.array(z.unknown()) });

const componentSchema = z.object({
  compensationType: z.string().nullish(),
  interval: z.string().nullish(),
  currencyCode: z.string().nullish(),
  minValue: z.number().nullish(),
  maxValue: z.number().nullish(),
});

export const jobSchema = z.object({
  /** Slug do board, acrescentado pelo conector ao devolver cada vaga. */
  board: z.string().min(1),
  id: z.string().min(1),
  title: z.string().trim().min(1),
  jobUrl: z.string().min(1),
  isListed: z.boolean().nullish(),
  department: z.string().nullish(),
  team: z.string().nullish(),
  location: z.string().nullish(),
  isRemote: z.boolean().nullish(),
  workplaceType: z.string().nullish(),
  publishedAt: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
  address: z
    .object({
      postalAddress: z
        .object({ addressCountry: z.string().nullish(), addressLocality: z.string().nullish() })
        .nullish(),
    })
    .nullish(),
  compensation: z.object({ summaryComponents: z.array(componentSchema).nullish() }).nullish(),
});

async function fetchBoard(ctx: ConnectorContext, slug: string): Promise<unknown[]> {
  const url = `https://${ASHBY_HOST}/posting-api/job-board/${slug}?includeCompensation=true`;
  const res = await ctx.fetchJson(url, { signal: ctx.signal });
  if (res.status !== 200) throw new Error(`Ashby ${slug} respondeu ${res.status}`);
  const parsed = boardSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`Ashby ${slug}: resposta fora do formato esperado`);
  return parsed.data.jobs.map((job) =>
    typeof job === "object" && job !== null ? { ...(job as Record<string, unknown>), board: slug } : job,
  );
}

function fetchBoards(ctx: ConnectorContext): AsyncGenerator<unknown> {
  return fetchBoardsPooled(ctx, "Ashby", ASHBY_BOARDS, (slug) => fetchBoard(ctx, slug));
}

const WORK_MODES: Record<string, WorkMode> = { remote: "remote", hybrid: "hybrid", onsite: "onsite" };
const PERIODS: Record<string, "hour" | "month" | "year"> = { "1 HOUR": "hour", "1 MONTH": "month", "1 YEAR": "year" };

function salaryOf(components: z.infer<typeof componentSchema>[] | null | undefined): NormalizedJob["salary"] {
  const c = components?.find((x) => x.compensationType === "Salary");
  const period = c?.interval ? PERIODS[c.interval] : undefined;
  const currency = c?.currencyCode?.trim();
  if (!c || !period || !currency) return null;
  const min = c.minValue ?? null;
  const max = c.maxValue ?? null;
  return min === null && max === null ? null : { min, max, currency, period };
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const slugName = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);

export const ashby: Connector = {
  id: "ashby",
  brazilian: false,
  fullSnapshot: true,
  minIntervalMinutes: 60,
  allowedHosts: [ASHBY_HOST],
  attribution: { label: "Ashby", url: "https://www.ashbyhq.com", dofollow: false },
  fetch: fetchBoards,
  normalize(raw): NormalizedJob | null {
    const parsed = jobSchema.safeParse(raw);
    if (!parsed.success) return null;
    const j = parsed.data;
    if (j.isListed === false || !safeUrl(j.jobUrl)) return null;

    const locationText = j.location?.trim() ?? "";
    const loc = parseLocation(locationText);
    const postal = j.address?.postalAddress;
    // Estruturado antes do texto livre: workplaceType, depois isRemote, depois o texto.
    const workMode: WorkMode | null =
      WORK_MODES[(j.workplaceType ?? "").toLowerCase()] ?? (j.isRemote === true && !j.workplaceType ? "remote" : loc.workMode);
    const structuredCountry = countryCodeFromName(postal?.addressCountry);
    const regions = new Set(loc.regions);
    if (workMode === "remote" && structuredCountry && postal?.addressCountry) regions.add(postal.addressCountry.trim());

    return {
      externalId: `${j.board}:${j.id}`,
      url: j.jobUrl,
      title: j.title,
      company: slugName(j.board),
      companyLogoUrl: null,
      descriptionHtml: j.descriptionHtml ?? "",
      descriptionFormat: "html",
      country: structuredCountry ?? loc.country,
      city: postal?.addressLocality?.trim() || loc.city,
      locationText: locationText || null,
      eligibleRegions: [...regions],
      workModeHint: workMode,
      seniorityHint: null,
      tags: [...new Set([j.department, j.team].map((t) => t?.trim() ?? "").filter(Boolean))],
      salary: salaryOf(j.compensation?.summaryComponents),
      publishedAt: toDate(j.publishedAt),
    };
  },
};
