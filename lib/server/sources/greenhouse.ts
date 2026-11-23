import "server-only";
import { z } from "@/lib/shared/zod";
import { safeUrl } from "@/lib/shared/url";
import { fetchBoardsPooled } from "@/lib/server/sources/boards";
import { parseLocation } from "@/lib/server/sources/location";
import type { Connector, ConnectorContext, NormalizedJob } from "@/lib/server/sources/types";

export { parseLocation, type ParsedLocation } from "@/lib/server/sources/location";

/** Host fixo da API (D-07): o fetch seguro só aceita URLs base definidas no código. */
export const GREENHOUSE_HOST = "boards-api.greenhouse.io";

/** Boards curados da D-07 (nada além desta lista é consultado). */
export const GREENHOUSE_BOARDS = [
  "stone", "c6bank", "btgpactual", "xpinc", "inter", "quintoandar", "gympass", "clara", "ebanx", "vtex",
  "jusbrasil", "wildlifestudios", "getnet", "gitlab", "canonical", "twilio", "datadog", "stripe", "databricks",
] as const;

const boardSchema = z.object({ jobs: z.array(z.unknown()) });

const jobSchema = z.object({
  /** Slug do board, acrescentado pelo conector ao devolver cada vaga. */
  board: z.string().min(1),
  id: z.number(),
  title: z.string().trim().min(1),
  absolute_url: z.string().min(1),
  company_name: z.string().nullish(),
  content: z.string().nullish(),
  first_published: z.string().nullish(),
  updated_at: z.string().nullish(),
  location: z.object({ name: z.string().nullish() }).nullish(),
  departments: z.array(z.object({ name: z.string().nullish() })).nullish(),
});

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };

/** O `content` do Greenhouse vem como HTML escapado; uma única passada evita decodificar duas vezes. */
export function decodeEntities(input: string): string {
  return input.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec?: string, hex?: string, name?: string) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? match;
    const code = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? "", 16);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

// --- coleta -----------------------------------------------------------------------------------

async function fetchBoard(ctx: ConnectorContext, slug: string): Promise<unknown[]> {
  const url = `https://${GREENHOUSE_HOST}/v1/boards/${slug}/jobs?content=true`;
  const res = await ctx.fetchJson(url, { signal: ctx.signal });
  if (res.status !== 200) throw new Error(`Greenhouse ${slug} respondeu ${res.status}`);
  const parsed = boardSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`Greenhouse ${slug}: resposta fora do formato esperado`);
  return parsed.data.jobs.map((job) =>
    typeof job === "object" && job !== null ? { ...(job as Record<string, unknown>), board: slug } : job,
  );
}

function fetchBoards(ctx: ConnectorContext): AsyncGenerator<unknown> {
  return fetchBoardsPooled(ctx, "Greenhouse", GREENHOUSE_BOARDS, (slug) => fetchBoard(ctx, slug));
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

const slugName = (slug: string) => slug.charAt(0).toUpperCase() + slug.slice(1);

export const greenhouse: Connector = {
  id: "greenhouse",
  brazilian: false,
  fullSnapshot: true,
  minIntervalMinutes: 60,
  allowedHosts: [GREENHOUSE_HOST],
  attribution: { label: "Greenhouse", url: "https://www.greenhouse.com", dofollow: false },
  fetch: fetchBoards,
  normalize(raw): NormalizedJob | null {
    const parsed = jobSchema.safeParse(raw);
    if (!parsed.success) return null;
    const j = parsed.data;
    if (!safeUrl(j.absolute_url)) return null;

    const locationName = j.location?.name?.trim() ?? "";
    const loc = parseLocation(locationName);
    return {
      externalId: `${j.board}:${j.id}`,
      url: j.absolute_url,
      title: j.title,
      company: j.company_name?.trim() || slugName(j.board),
      companyLogoUrl: null,
      descriptionHtml: decodeEntities(j.content ?? ""),
      descriptionFormat: "html",
      country: loc.country,
      city: loc.city,
      locationText: locationName || null,
      eligibleRegions: loc.regions,
      workModeHint: loc.workMode,
      seniorityHint: null,
      tags: (j.departments ?? []).map((d) => d.name?.trim() ?? "").filter(Boolean),
      salary: null,
      publishedAt: toDate(j.first_published) ?? toDate(j.updated_at),
    };
  },
};
