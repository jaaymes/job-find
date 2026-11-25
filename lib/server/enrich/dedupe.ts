import "server-only";
import { createHash } from "node:crypto";
import type { WorkMode } from "@/lib/shared/types/job";
import { normalizeText } from "./text";

const sha1 = (value: string) => createHash("sha1").update(value).digest("hex");

/** Troca pontuação por espaço (não toca em `+` nem `#`, que distinguem C++ e C#) e colapsa espaços. */
const stripPunctuation = (value: string) =>
  value
    .replace(/[.,;:!?()[\]/\\\-—–_|"']/g, " ")
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

/**
 * Remove, numa passada só (linear), os segmentos finais entre parênteses ou após
 * ` - `, ` – `, ` — ` ou ` | ` que sejam apenas modo/região.
 */
function stripTrailingSegments(title: string): string {
  const separators = [...title.matchAll(/\s[-–—|]\s/g)];
  let end = title.length;
  for (;;) {
    while (end > 0 && /\s/.test(title[end - 1])) end--;
    if (title[end - 1] === ")") {
      const open = title.lastIndexOf("(", end - 1);
      const inner = open >= 0 ? title.slice(open + 1, end - 1) : "";
      if (open >= 0 && !inner.includes(")") && isModeRegionSegment(inner)) {
        end = open;
        continue;
      }
      break;
    }
    // Descarta separadores que ficaram dentro de trechos já removidos.
    while (separators.length > 0 && separators[separators.length - 1].index + 3 > end) {
      separators.pop();
    }
    const last = separators[separators.length - 1];
    if (last && isModeRegionSegment(title.slice(last.index + 3, end))) {
      end = last.index;
      separators.pop();
      continue;
    }
    break;
  }
  return title.slice(0, end).trim();
}

/** Abreviação só vale como palavra isolada (`PL/SQL` não vira "pleno sql"). */
function expandSeniority(title: string): string {
  return title
    .split(" ")
    .map((token) => SENIORITY[token.replace(/^[.,;:!?()[\]"']+|[.,;:!?()[\]"']+$/g, "")] ?? token)
    .join(" ");
}

/** Tira marcador de gênero, modo/região no fim e iguala abreviações de senioridade. */
export function normalizeTitle(value: string): string {
  const base = normalizeText(value).replace(GENDER_MARKER, " ").replace(/\s+/g, " ").trim();
  const result = stripPunctuation(expandSeniority(stripTrailingSegments(base)));
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
