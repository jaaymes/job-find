import "server-only";
import { normalizeText } from "@/lib/server/enrich/text";
import type { WorkMode } from "@/lib/shared/types/job";

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

/** ISO-2 de um nome de país por extenso ("Brazil", "United States"); `null` se desconhecido. */
export function countryCodeFromName(name: string | null | undefined): string | null {
  return COUNTRIES.get(normalizeText(name))?.code ?? null;
}

/** Nome por extenso (inglês) de um código ISO-2 conhecido; `null` se desconhecido. */
export function countryNameFromCode(code: string | null | undefined): string | null {
  const upper = code?.trim().toUpperCase();
  for (const c of COUNTRIES.values()) if (c.code === upper) return c.name;
  return null;
}
