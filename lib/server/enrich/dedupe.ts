import "server-only";
import { createHash } from "node:crypto";
import type { WorkMode } from "@/lib/shared/types/job";
import { normalizeText } from "./text";

const sha1 = (value: string) => createHash("sha1").update(value).digest("hex");

/** Troca pontuação por espaço (não toca em `+` nem `#`, que distinguem C++ e C#) e colapsa espaços. */
const stripPunctuation = (value: string) =>
  value
    .replace(/[.,;:!?()[\]/\\\-_|"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Sufixos societários, já como sequências de palavras após a normalização. */
const COMPANY_SUFFIXES: string[][] = [
  "inc",
  "llc",
  "ltd",
  "limited",
  "ltda",
  "sa",
  "s a",
  "me",
  "eireli",
  "gmbh",
  "ag",
  "corp",
  "corporation",
  "co",
  "plc",
  "bv",
  "b v",
  "srl",
  "sas",
  "oy",
  "ab",
  "pty",
].map((suffix) => suffix.split(" "));

/** Remove sufixos societários só no fim do nome, repetidamente; nunca devolve vazio. */
export function normalizeCompany(value: string): string {
  const normalized = stripPunctuation(normalizeText(value));
  const words = normalized.split(" ").filter(Boolean);
  let end = words.length;
  for (let changed = true; changed; ) {
    changed = false;
    for (const suffix of COMPANY_SUFFIXES) {
      const start = end - suffix.length;
      if (start >= 0 && suffix.every((word, i) => words[start + i] === word)) {
        end = start;
        changed = true;
        break;
      }
    }
  }
  return end > 0 ? words.slice(0, end).join(" ") : normalized;
}

/** Marcadores de gênero, só entre parênteses ou colchetes (nunca a palavra solta "a"/"o"). */
const GENDER_MARKER =
  /[([]\s*(?:m\/w\/d|m\/f\/d|f\/m\/d|w\/m\/d|m\/f\/x|f\/m\/x|h\/f|f\/h|m\/f|all genders|a\/e\/o|a|o)\s*[)\]]/g;

/** Palavras que, sozinhas, formam um segmento final de modo ou região descartável. */
const MODE_REGION_WORDS = new Set([
  "remote",
  "remoto",
  "hybrid",
  "hibrido",
  "onsite",
  "presencial",
  "homeoffice",
  "brazil",
  "brasil",
  "latam",
  "worldwide",
  "anywhere",
]);

const SENIORITY: Record<string, string> = { sr: "senior", jr: "junior", pl: "pleno" };

function isModeRegionSegment(segment: string): boolean {
  const words = stripPunctuation(segment)
    .replace(/\bhome office\b/g, "homeoffice")
    .replace(/\bon site\b/g, "onsite")
    .split(" ")
    .filter(Boolean);
  return words.length > 0 && words.every((word) => MODE_REGION_WORDS.has(word));
}

/** Remove um segmento final entre parênteses ou após ` - `, ` – ` ou ` | ` se for só modo/região. */
function stripTrailingSegment(title: string): string {
  const parenthesized = /\(([^()]*)\)\s*$/.exec(title);
  if (parenthesized && isModeRegionSegment(parenthesized[1])) {
    return title.slice(0, parenthesized.index).trim();
  }
  const last = [...title.matchAll(/\s[-–|]\s/g)].at(-1);
  if (last?.index !== undefined && isModeRegionSegment(title.slice(last.index + last[0].length))) {
    return title.slice(0, last.index).trim();
  }
  return title;
}

/** Tira marcador de gênero, modo/região no fim e iguala abreviações de senioridade. */
export function normalizeTitle(value: string): string {
  const base = normalizeText(value).replace(GENDER_MARKER, " ").replace(/\s+/g, " ").trim();
  let title = base;
  for (let previous = ""; previous !== title; ) {
    previous = title;
    title = stripTrailingSegment(title);
  }
  const result = stripPunctuation(title)
    .split(" ")
    .map((word) => SENIORITY[word] ?? word)
    .join(" ");
  // Título que só tinha modo/região não pode ficar vazio.
  return result || stripPunctuation(base);
}

/** RN-05: empresa + título + país + cidade + modelo de trabalho, normalizados. */
export function dedupeKey(i: {
  company: string;
  title: string;
  country: string | null;
  city: string | null;
  workMode: WorkMode;
}): string {
  return sha1(
    [
      normalizeCompany(i.company),
      normalizeTitle(i.title),
      ...[i.country, i.city, i.workMode].map((v) => normalizeText(v)),
    ].join("|"),
  );
}

export function contentHash(parts: string[]): string {
  return sha1(parts.join("\u0000"));
}
