import "server-only";
import { safeUrl } from "@/lib/shared/url";

const TRACKING_PARAM = /^(utm_|gh_src$|ref$|source$|fbclid$|gclid$)/i;

/** Variações de host de um mesmo ATS que abrem a mesma página da vaga. */
const HOST_ALIASES: Record<string, string> = {
  "job-boards.greenhouse.io": "boards.greenhouse.io",
  "job-boards.eu.greenhouse.io": "boards.eu.greenhouse.io",
};

/** Sufixo de "candidatar-se" que só existe nesses ATS; em outros hosts `/apply` pode ser outra página. */
const APPLY_SUFFIX: Record<string, string> = {
  "jobs.lever.co": "/apply",
  "jobs.ashbyhq.com": "/application",
};

function trimTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

/**
 * URL canônica: https válida, sem fragmento nem parâmetros de rastreamento, com host em minúsculas
 * sem `www.`, variações de ATS unificadas, parâmetros ordenados e sem barra final (exceto na raiz).
 * A URL também é exibida ao usuário, então toda transformação mantém um link que abre a mesma
 * vaga; a caixa do caminho é preservada.
 */
export function canonicalUrl(raw: string): string | null {
  const safe = safeUrl(raw);
  if (!safe) return null;
  const url = new URL(safe);
  url.hash = "";

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  url.hostname = HOST_ALIASES[host] ?? host;

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();

  let path = trimTrailingSlash(url.pathname);
  const suffix = APPLY_SUFFIX[url.hostname];
  if (suffix && path.endsWith(suffix)) path = trimTrailingSlash(path.slice(0, -suffix.length) || "/");
  url.pathname = path;

  return url.toString();
}
