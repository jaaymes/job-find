import "server-only";
import { extractStacks } from "@/lib/shared/stacks";
import type { Seniority, SourceId, WorkMode } from "@/lib/shared/types/job";
import { safeUrl } from "@/lib/shared/url";
import { contentHash as hashParts, dedupeKey } from "@/lib/server/enrich/dedupe";
import { detectLanguage } from "@/lib/server/enrich/language";
import { classifyOrigin } from "@/lib/server/enrich/origin";
import { detectSeniority } from "@/lib/server/enrich/seniority";
import { isTechJob } from "@/lib/server/enrich/tech";
import { classifyWorkMode } from "@/lib/server/enrich/work-mode";
import {
  SANITIZER_VERSION,
  htmlToText,
  markdownToSafeHtml,
  sanitizeJobHtml,
  summarize,
} from "@/lib/server/sanitize";
import type { NormalizedJob } from "@/lib/server/sources/types";

/** Vaga pronta para o upsert: espelha as colunas de `jobs` (menos as controladas pelo banco). */
export type EnrichedJob = {
  dedupeKey: string;
  urlCanonical: string;
  title: string;
  company: string;
  companyLogoUrl: string | null;
  summary: string;
  descriptionHtml: string;
  sanitizerVersion: number;
  /** Texto puro da descrição, usado só para o vetor de busca (não é coluna). */
  searchBody: string;
  country: string | null;
  city: string | null;
  origin: "national" | "international" | "unknown";
  acceptsBrazil: boolean | null;
  workMode: WorkMode;
  seniority: Seniority | null;
  language: string;
  stacks: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: "hour" | "month" | "year" | null;
  /** Data informada pela fonte; o upsert aplica o teto (now) e o fallback (first_seen). */
  publishedAt: Date | null;
  /** `computeContentHash`: conteúdo bruto + versão do sanitizador; decide se vale sanitizar e atualizar de novo. */
  contentHash: string;
};

const TRACKING_PARAM = /^(utm_|gh_src$|ref$|source$|fbclid$|gclid$)/i;

/** URL canônica: https válida, sem fragmento e sem parâmetros de rastreamento. */
function canonicalUrl(raw: string): string | null {
  const safe = safeUrl(raw);
  if (!safe) return null;
  const url = new URL(safe);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

function cleanCountry(value: string | null): string | null {
  const c = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

/**
 * Hash do conteúdo bruto normalizado (barato: sem sanitizar nem analisar texto). Independe da
 * fonte e da URL; inclui a versão do sanitizador, para que subir a versão invalide o HTML salvo
 * e force a re-sanitização (no `enrichJob` e no atalho de vagas inalteradas da coleta).
 */
export function computeContentHash(n: NormalizedJob, sanitizerVersion: number = SANITIZER_VERSION): string {
  return hashParts([
    `sanitizer:${sanitizerVersion}`,
    n.title,
    n.company,
    n.companyLogoUrl ?? "",
    n.descriptionFormat,
    n.descriptionHtml,
    n.country ?? "",
    n.city ?? "",
    n.locationText ?? "",
    [...n.eligibleRegions].sort().join(","),
    n.workModeHint ?? "",
    n.seniorityHint ?? "",
    [...n.tags].sort().join(","),
    JSON.stringify(n.salary),
  ]);
}

/**
 * Normaliza e enriquece uma vaga de uma fonte. Devolve `null` quando não é vaga
 * de tecnologia (RN-01) ou a URL é inválida (SEC-03). Quando `prev.contentHash`
 * é igual ao hash do conteúdo bruto, reaproveita o HTML já sanitizado (poupa CPU).
 */
export function enrichJob(
  n: NormalizedJob,
  src: { id: SourceId; brazilian: boolean; dofollow: boolean },
  prev?: { contentHash: string; descriptionHtml: string } | null,
): EnrichedJob | null {
  if (!isTechJob(n.title, n.tags)) return null;
  const urlCanonical = canonicalUrl(n.url);
  if (!urlCanonical) return null;

  const hash = computeContentHash(n);

  const descriptionHtml =
    prev && prev.contentHash === hash
      ? prev.descriptionHtml
      : n.descriptionFormat === "markdown"
        ? markdownToSafeHtml(n.descriptionHtml)
        : sanitizeJobHtml(n.descriptionHtml, { dofollow: src.dofollow });
  const searchBody = htmlToText(descriptionHtml);

  const country = cleanCountry(n.country);
  const city = n.city?.trim() || null;
  const workMode = classifyWorkMode(n.workModeHint, `${n.title} ${n.locationText ?? ""}`);
  const { origin, acceptsBrazil } = classifyOrigin({
    country,
    locationText: n.locationText,
    eligibleRegions: n.eligibleRegions,
    sourceIsBrazilian: src.brazilian,
  });

  const currency = n.salary?.currency.trim().toUpperCase() ?? "";
  const salary = n.salary && /^[A-Z]{3}$/.test(currency) ? n.salary : null;

  return {
    dedupeKey: dedupeKey({ company: n.company, title: n.title, country, city, workMode }),
    urlCanonical,
    title: n.title.trim(),
    company: n.company.trim(),
    companyLogoUrl: n.companyLogoUrl ? safeUrl(n.companyLogoUrl) : null,
    summary: summarize(descriptionHtml),
    descriptionHtml,
    sanitizerVersion: SANITIZER_VERSION,
    searchBody,
    country,
    city,
    origin,
    acceptsBrazil,
    workMode,
    seniority: detectSeniority(n.title, n.seniorityHint),
    language: detectLanguage(searchBody),
    stacks: extractStacks({ title: n.title, tags: n.tags, body: searchBody }).map((s) => s.id),
    salaryMin: salary?.min ?? null,
    salaryMax: salary?.max ?? null,
    salaryCurrency: salary ? currency : null,
    salaryPeriod: salary?.period ?? null,
    publishedAt: n.publishedAt,
    contentHash: hash,
  };
}
