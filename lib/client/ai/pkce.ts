import "client-only";

import { AiError } from "./errors";

const VERIFIER_KEY = "jobfind:pkce";
const FREE_CONSENT_KEY = "jobfind:pkce:free";
const AUTH_URL = "https://openrouter.ai/auth";
const KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function clearVerifier(): void {
  try {
    sessionStorage.removeItem(VERIFIER_KEY);
  } catch {
    // sessionStorage indisponível: nada a limpar
  }
}

/** Gera o verifier (32 bytes aleatórios), guarda no sessionStorage e devolve a URL de autorização do OpenRouter. */
export async function startOpenRouterAuth(callbackUrl: string, opts: { freeConsent?: boolean } = {}): Promise<string> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  try {
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    // O aceite do aviso dos gratuitos precisa atravessar o redirect até o callback.
    if (opts.freeConsent) sessionStorage.setItem(FREE_CONSENT_KEY, "1");
    else sessionStorage.removeItem(FREE_CONSENT_KEY);
  } catch (cause) {
    throw new AiError("unavailable", { meta: { reason: "storage" }, cause });
  }
  const url = new URL(AUTH_URL);
  url.searchParams.set("callback_url", callbackUrl);
  url.searchParams.set("code_challenge", base64url(new Uint8Array(digest)));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("limit", "5");
  url.searchParams.set("expiration", "1-year");
  return url.toString();
}

/** Troca o `code` pela chave. O verifier é removido em qualquer desfecho; code, verifier e chave nunca vão a log ou erro. */
export async function completeOpenRouterAuth(code: string): Promise<string> {
  let verifier: string | null = null;
  try {
    verifier = sessionStorage.getItem(VERIFIER_KEY);
  } catch {
    verifier = null;
  }
  if (!verifier) {
    throw new AiError("unavailable", { meta: { reason: "missing_verifier" } });
  }
  try {
    let res: Response;
    try {
      res = await fetch(KEYS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
      });
    } catch {
      throw new AiError("unavailable", { retryable: true, meta: { reason: "network" } });
    }
    if (!res.ok) {
      const code401 = res.status === 401 || res.status === 403;
      throw new AiError(code401 ? "invalid_key" : "unavailable", {
        retryable: res.status >= 500,
        meta: { status: res.status },
      });
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const key = typeof data === "object" && data !== null ? (data as { key?: unknown }).key : undefined;
    if (typeof key !== "string" || key === "") {
      throw new AiError("unavailable", { meta: { reason: "invalid_response" } });
    }
    return key;
  } finally {
    clearVerifier();
  }
}

/** Lê e apaga o aceite do aviso dos gratuitos guardado por `startOpenRouterAuth`. */
export function takeFreeConsentIntent(): boolean {
  try {
    const v = sessionStorage.getItem(FREE_CONSENT_KEY);
    sessionStorage.removeItem(FREE_CONSENT_KEY);
    return v === "1";
  } catch {
    return false;
  }
}
