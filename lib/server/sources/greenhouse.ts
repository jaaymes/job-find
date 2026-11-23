import "server-only";
import { z } from "zod";
import { normalizeText } from "@/lib/server/enrich/text";
import { safeUrl } from "@/lib/shared/url";
import type { WorkMode } from "@/lib/shared/types/job";
import type { Connector, ConnectorContext, NormalizedJob } from "@/lib/server/sources/types";

/** Host fixo da API (D-07): o fetch seguro só aceita URLs base definidas no código. */
export const GREENHOUSE_HOST = "boards-api.greenhouse.io";

/** Boards curados da D-07 (nada além desta lista é consultado). */
export const GREENHOUSE_BOARDS = [
  "stone", "c6bank", "btgpactual", "xpinc", "inter", "quintoandar", "gympass", "clara", "ebanx", "vtex",
  "jusbrasil", "wildlifestudios", "getnet", "gitlab", "canonical", "twilio", "datadog", "stripe", "databricks",
] as const;

const CONCURRENCY = 3;

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

// --- parser de `location.name` ---------------------------------------------------------------

type Place = { code: string; name: string };
const place = (code: string, name: string): [string, Place] => [normalizeText(name), { code, name }];

const COUNTRIES = new Map<string, Place>([
  ...[
    ["BR", "Brazil"], ["US", "United States"], ["GB", "United Kingdom"], ["CA", "Canada"], ["PL", "Poland"],
    ["IE", "Ireland"], ["ES", "Spain"], ["PT", "Portugal"], ["DE", "Germany"], ["FR", "France"],
    ["NL", "Netherlands"], ["AR", "Argentina"], ["MX", "Mexico"], ["CO", "Colombia"], ["CL", "Chile"],
    ["IN", "India"], ["AU", "Australia"], ["IT", "Italy"], ["SG", "Singapore"], ["JP", "Japan"],
  ].map(([c, n]) => place(c!, n!)),
  ["brasil", { code: "BR", name: "Brazil" }],
  ["usa", { code: "US", name: "United States" }],
  ["us", { code: "US", name: "United States" }],
  ["uk", { code: "GB", name: "United Kingdom" }],
]);

const REGIONS = new Map<string, string>([
  ["north america", "North America"],
  ["latin america", "Latin America"],
  ["latam", "Latin America"],
  ["south america", "South America"],
  ["emea", "EMEA"],
  ["europe", "Europe"],
  ["apac", "APAC"],
  ["americas", "Americas"],
  ["worldwide", "Worldwide"],
  ["anywhere", "Worldwide"],
]);

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " ",
  ),
);

export type ParsedLocation = {
  country: string | null;
  city: string | null;
  workMode: WorkMode | null;
  /** Países/regiões citados em vagas remotas: viram `eligibleRegions`. */
  regions: string[];
};

const MODE_WORDS: [RegExp, WorkMode][] = [
  [/\b(?:hybrid|hibrido)\b/gi, "hybrid"],
  [/\b(?:remote|remoto)\b/gi, "remote"],
  [/\b(?:on-?site|presencial)\b/gi, "onsite"],
];
const MODE_PRIORITY: WorkMode[] = ["hybrid", "remote", "onsite"];

type Segment = { city: string | null; country: Place | null; region: string | null; modes: WorkMode[] };

function parseSegment(raw: string): Segment {
  let text = raw.replace(/[()]/g, ",");
  const modes: WorkMode[] = [];
  for (const [re, mode] of MODE_WORDS) {
    if (re.test(text)) modes.push(mode);
    re.lastIndex = 0;
    text = text.replace(re, ",");
  }
  const parts = text
    .split(/\s*,\s*|\s+[-–—|]\s+|\s*[|/]\s*/)
    .map((p) => p.replace(/^[\s\-–—|]+|[\s\-–—|]+$/g, ""))
    .filter(Boolean);

  let country: Place | null = null;
  let region: string | null = null;
  const last = parts[parts.length - 1];
  if (last) {
    const key = normalizeText(last);
    const found = COUNTRIES.get(key);
    if (found) country = found;
    else if (REGIONS.has(key)) region = REGIONS.get(key)!;
    else if (parts.length > 1 && /^[A-Z]{2}$/.test(last) && US_STATES.has(last)) country = COUNTRIES.get("united states")!;
    if (country || region) parts.pop();
  }
  return { city: parts[0] ?? null, country, region, modes };
}

/** Extrai país (ISO-2), cidade e modelo de trabalho de textos como "Remote - Brazil" ou "New York, NY". */
export function parseLocation(name: string): ParsedLocation {
  const segments = name.split(";").map((s) => s.trim()).filter(Boolean).map(parseSegment);
  const modes = new Set(segments.flatMap((s) => s.modes));
  const countries = new Set(segments.flatMap((s) => (s.country ? [s.country.code] : [])));
  const regions = new Set<string>();
  for (const s of segments) {
    if (!s.modes.includes("remote")) continue;
    if (s.country) regions.add(s.country.name);
    if (s.region) regions.add(s.region);
  }
  return {
    country: countries.size === 1 ? [...countries][0]! : null,
    city: segments.length === 1 ? segments[0]!.city : null,
    workMode: MODE_PRIORITY.find((m) => modes.has(m)) ?? null,
    regions: [...regions],
  };
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

async function* fetchBoards(ctx: ConnectorContext): AsyncGenerator<unknown> {
  const results: unknown[][] = GREENHOUSE_BOARDS.map(() => []);
  let failures = 0;
  let next = 0;
  const worker = async () => {
    while (next < GREENHOUSE_BOARDS.length) {
      const i = next++;
      try {
        results[i] = await fetchBoard(ctx, GREENHOUSE_BOARDS[i]!);
      } catch {
        // Um board fora do ar (404, rede, formato) não derruba os outros; o runner vê só os que responderam.
        failures++;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  // Se nada respondeu, a fonte está quebrada: lançar permite ao runner distinguir de uma coleta vazia.
  if (failures === GREENHOUSE_BOARDS.length) throw new Error("Greenhouse: todos os boards falharam");
  for (const jobs of results) yield* jobs;
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
