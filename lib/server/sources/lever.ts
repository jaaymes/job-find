import "server-only";
import { z } from "@/lib/shared/zod";
import { fetchBoardsPooled } from "@/lib/server/sources/boards";
import { countryNameFromCode, parseLocation } from "@/lib/server/sources/location";
import { safeUrl } from "@/lib/shared/url";
import type { WorkMode } from "@/lib/shared/types/job";
import type { Connector, ConnectorContext, NormalizedJob } from "@/lib/server/sources/types";

/** Host fixo da API (D-07): o fetch seguro só aceita URLs base definidas no código. */
export const LEVER_HOST = "api.lever.co";

/** Boards curados da D-07 (nada além desta lista é consultado). */
export const LEVER_BOARDS = ["ciandt", "neon", "swile", "toptal", "spotify"] as const;

const boardSchema = z.array(z.unknown());

const jobSchema = z.object({
  /** Slug do board, acrescentado pelo conector ao devolver cada vaga. */
  board: z.string().min(1),
  id: z.string().min(1),
  text: z.string().trim().min(1),
  hostedUrl: z.string().min(1),
  /** Epoch em milissegundos. */
  createdAt: z.number().nullish(),
  country: z.string().nullish(),
  workplaceType: z.string().nullish(),
  description: z.string().nullish(),
  opening: z.string().nullish(),
  descriptionBody: z.string().nullish(),
  lists: z.array(z.object({ text: z.string().nullish(), content: z.string().nullish() })).nullish(),
  additional: z.string().nullish(),
  categories: z
    .object({
      location: z.string().nullish(),
      allLocations: z.array(z.string()).nullish(),
      department: z.string().nullish(),
      team: z.string().nullish(),
    })
    .nullish(),
  salaryRange: z
    .object({
      min: z.number().nullish(),
      max: z.number().nullish(),
      currency: z.string().nullish(),
      interval: z.string().nullish(),
    })
    .nullish(),
});

async function fetchBoard(ctx: ConnectorContext, slug: string): Promise<unknown[]> {
  const url = `https://${LEVER_HOST}/v0/postings/${slug}?mode=json`;
  const res = await ctx.fetchJson(url, { signal: ctx.signal });
  if (res.status !== 200) throw new Error(`Lever ${slug} respondeu ${res.status}`);
  const parsed = boardSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`Lever ${slug}: resposta fora do formato esperado`);
  return parsed.data.map((job) =>
    typeof job === "object" && job !== null ? { ...(job as Record<string, unknown>), board: slug } : job,
  );
}

function fetchBoards(ctx: ConnectorContext): AsyncGenerator<unknown> {
  return fetchBoardsPooled(ctx, "Lever", LEVER_BOARDS, (slug) => fetchBoard(ctx, slug));
}

const WORK_MODES: Record<string, WorkMode> = { remote: "remote", hybrid: "hybrid", onsite: "onsite" };
const PERIODS: Record<string, "hour" | "month" | "year"> = {
  "per-hour-wage": "hour",
  "per-month-salary": "month",
  "per-year-salary": "year",
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * O Lever entrega a vaga em pedaços: `description` (abertura + corpo), `lists` (seções com `<li>`
 * soltos) e `additional`. Concatenados nessa ordem, formam o HTML completo da vaga.
 */
function composeDescription(j: z.infer<typeof jobSchema>): string {
  const intro = j.description ?? `${j.opening ?? ""}${j.descriptionBody ?? ""}`;
  const lists = (j.lists ?? [])
    .filter((l) => l.content)
    .map((l) => `${l.text ? `<h3>${escapeHtml(l.text)}</h3>` : ""}<ul>${l.content}</ul>`)
    .join("");
  return `${intro}${lists}${j.additional ?? ""}`;
}

function salaryOf(range: z.infer<typeof jobSchema>["salaryRange"]): NormalizedJob["salary"] {
  const period = range?.interval ? PERIODS[range.interval] : undefined;
  const currency = range?.currency?.trim();
  if (!range || !period || !currency) return null;
  const min = range.min ?? null;
  const max = range.max ?? null;
  return min === null && max === null ? null : { min, max, currency, period };
}

const slugName = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);

export const lever: Connector = {
  id: "lever",
  brazilian: false,
  fullSnapshot: true,
  minIntervalMinutes: 60,
  allowedHosts: [LEVER_HOST],
  attribution: { label: "Lever", url: "https://www.lever.co", dofollow: false },
  fetch: fetchBoards,
  normalize(raw): NormalizedJob | null {
    const parsed = jobSchema.safeParse(raw);
    if (!parsed.success) return null;
    const j = parsed.data;
    if (!safeUrl(j.hostedUrl)) return null;

    const cats = j.categories;
    const locationText = (cats?.location ?? cats?.allLocations?.[0] ?? "").trim();
    const loc = parseLocation(locationText);
    const iso = j.country?.trim().toUpperCase();
    const structuredCountry = iso && /^[A-Z]{2}$/.test(iso) ? iso : null;
    const workMode = WORK_MODES[(j.workplaceType ?? "").toLowerCase()] ?? loc.workMode;
    const regions = new Set(loc.regions);
    const countryName = countryNameFromCode(structuredCountry);
    if (workMode === "remote" && countryName) regions.add(countryName);

    return {
      externalId: `${j.board}:${j.id}`,
      url: j.hostedUrl,
      title: j.text,
      company: slugName(j.board),
      companyLogoUrl: null,
      descriptionHtml: composeDescription(j),
      descriptionFormat: "html",
      country: structuredCountry ?? loc.country,
      city: loc.city,
      locationText: locationText || null,
      eligibleRegions: [...regions],
      workModeHint: workMode,
      seniorityHint: null,
      tags: [...new Set([cats?.department, cats?.team].map((t) => t?.trim() ?? "").filter(Boolean))],
      salary: salaryOf(j.salaryRange),
      publishedAt: j.createdAt != null && Number.isFinite(j.createdAt) ? new Date(j.createdAt) : null,
    };
  },
};
