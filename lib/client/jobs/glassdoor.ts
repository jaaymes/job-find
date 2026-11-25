import type { JobOrigin } from "@/lib/shared/types/job";

/** Nomes genéricos (sem acento, minúsculos) que não identificam uma empresa. */
const GENERIC_NAMES = new Set([
  "confidencial",
  "empresa confidencial",
  "confidential",
  "stealth",
  "stealth startup",
  "undisclosed",
  "empresa",
  "n/a",
  "nao informado",
]);

/** Sufixo societário no fim do nome, precedido de espaço, vírgula ou início. */
const LEGAL_SUFFIX = /(?:^|[\s,]+)(?:Ltda\.?|S\.?\/?A\.?|ME|EPP|EIRELI|Inc\.?|LLC|Ltd\.?|GmbH|Corp\.?|Co\.?)[\s,]*$/i;

const stripAccents = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");

/** Limpa o nome da empresa para busca; devolve null se for genérico ou curto demais. */
export function normalizeCompanyForSearch(name: string): string | null {
  let result = name.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "");
  for (;;) {
    const next = result.replace(LEGAL_SUFFIX, "").replace(/^[\s,]+|[\s,]+$/g, "");
    if (next === result) break;
    result = next;
  }
  if (result.length < 2) return null;
  if (GENERIC_NAMES.has(stripAccents(result).toLowerCase())) return null;
  return result;
}

/** Monta o link de busca da empresa no Glassdoor. Só gera o link: o app nunca consulta o Glassdoor. */
export function buildGlassdoorUrl(company: string, origin: JobOrigin): string | null {
  const keyword = normalizeCompanyForSearch(company);
  if (!keyword) return null;
  const host = origin === "international" ? "https://www.glassdoor.com" : "https://www.glassdoor.com.br";
  const url = new URL("/Search/results.htm", host);
  url.searchParams.set("keyword", keyword);
  return url.toString();
}
