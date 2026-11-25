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

/** Chave decodificada de um par `chave=valor` da query (como o `URLSearchParams` a lê). */
function pairKey(pair: string): string {
  const raw = pair.split("=", 1)[0].replace(/\+/g, " ");
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Query sem parâmetros de rastreamento e com os pares ordenados pela chave. Cada par mantém o texto
 * original (`%20` não vira `+`), e a query só é reconstruída quando algo foi removido ou quando há
 * mais de um par: um parâmetro único fica exatamente como veio.
 */
function canonicalQuery(search: string): string {
  const pairs = search.replace(/^\?/, "").split("&").filter((p) => p !== "");
  const kept = pairs.filter((p) => !TRACKING_PARAM.test(pairKey(p)));
  if (kept.length === pairs.length && pairs.length <= 1) return search;
  // `sort` é estável: chaves repetidas mantêm a ordem original entre si.
  kept.sort((a, b) => {
    const ka = pairKey(a);
    const kb = pairKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return kept.length > 0 ? `?${kept.join("&")}` : "";
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

  url.search = canonicalQuery(url.search);

  let path = trimTrailingSlash(url.pathname);
  const suffix = APPLY_SUFFIX[url.hostname];
  if (suffix && path.endsWith(suffix)) path = trimTrailingSlash(path.slice(0, -suffix.length) || "/");
  url.pathname = path;

  return url.toString();
}
