import "server-only";
import { normalizeText } from "./text";

type Origin = { origin: "national" | "international" | "unknown"; acceptsBrazil: boolean | null };

const ACCEPTING_REGIONS = new Set([
  "worldwide",
  "anywhere",
  "latam",
  "latin america",
  "americas",
  "south america",
  "brazil",
  "brasil",
]);

const RESTRICTIVE =
  /\b(us|usa|u\.s\.|united states|uk|united kingdom|europe|european union|eu|emea|canada)\b/;

const BR_STATES = [
  "acre", "alagoas", "amapa", "amazonas", "bahia", "ceara", "distrito federal", "espirito santo",
  "goias", "maranhao", "mato grosso", "mato grosso do sul", "minas gerais", "para", "paraiba",
  "parana", "pernambuco", "piaui", "rio de janeiro", "rio grande do norte", "rio grande do sul",
  "rondonia", "roraima", "santa catarina", "sao paulo", "sergipe", "tocantins",
];
const BR_CITIES = [
  "sao paulo", "rio de janeiro", "belo horizonte", "curitiba", "porto alegre", "brasilia",
  "salvador", "fortaleza", "recife", "florianopolis", "campinas", "goiania", "manaus", "belem",
  "natal", "joinville", "uberlandia", "ribeirao preto", "sao jose dos campos", "santos",
];
const BR_UFS =
  "ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to";

const BR_TEXT = new RegExp(
  `\\b(?:brazil|brasil|${[...BR_STATES, ...BR_CITIES].join("|")})\\b|[,\\-/]\\s*(?:${BR_UFS})\\b`,
);
const REMOTE_TEXT = /\b(remote|remoto|anywhere)\b/;

/** RN-03 / D-08: origem (nacional/internacional) e elegibilidade Brasil. */
export function classifyOrigin(i: {
  country: string | null;
  locationText: string | null;
  eligibleRegions: string[];
  sourceIsBrazilian: boolean;
}): Origin {
  const text = normalizeText(i.locationText);
  const regions = i.eligibleRegions.map(normalizeText).filter(Boolean);
  const country = i.country?.trim().toUpperCase() || null;

  if (country === "BR") return { origin: "national", acceptsBrazil: true };

  const international = (): Origin => {
    if (regions.some((r) => ACCEPTING_REGIONS.has(r))) return { origin: "international", acceptsBrazil: true };
    return { origin: "international", acceptsBrazil: false };
  };

  // País estruturado estrangeiro vence o texto.
  if (country) return international();

  // Remoto com regiões de elegibilidade é tratado como vaga de empresa estrangeira.
  const foreignRemote = regions.length > 0 && (REMOTE_TEXT.test(text) || text === "");
  if (foreignRemote) return international();

  if (i.sourceIsBrazilian || BR_TEXT.test(text)) return { origin: "national", acceptsBrazil: true };

  if (regions.length > 0 || RESTRICTIVE.test(text)) return international();

  return { origin: "unknown", acceptsBrazil: null };
}
