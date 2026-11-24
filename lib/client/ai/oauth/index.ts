import "client-only";

import { AiError } from "../errors";
import { PROVIDER_IDS, PROVIDERS, type OAuthFlow, type OAuthTokens, type ProviderId } from "../providers";

/** O que precisa atravessar o redirect até o callback (ex.: aceite do aviso dos gratuitos do OpenRouter). */
export type OAuthIntent = { freeConsent?: boolean };

export const PENDING_KEY = "jobfind:oauth:pending";

type Pending = { provider: ProviderId; verifier: string; state: string; intent: OAuthIntent };

export function callbackUrl(origin: string): string {
  return `${origin}/configuracoes/callback`;
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Comparação em tempo constante (para o mesmo tamanho); tamanhos diferentes → falso. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function flowOf(id: ProviderId): OAuthFlow {
  const auth = PROVIDERS[id].auth;
  if (auth.kind !== "oauth") throw new AiError("unavailable", { meta: { reason: "not_oauth" } });
  return auth.flow;
}

function parsePending(raw: string | null): Pending | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const p = data as Record<string, unknown>;
  if (typeof p.provider !== "string" || !(PROVIDER_IDS as readonly string[]).includes(p.provider)) return null;
  if (typeof p.verifier !== "string" || p.verifier === "" || typeof p.state !== "string" || p.state === "") return null;
  const intent = typeof p.intent === "object" && p.intent !== null ? (p.intent as Record<string, unknown>) : {};
  return {
    provider: p.provider as ProviderId,
    verifier: p.verifier,
    state: p.state,
    intent: intent.freeConsent === true ? { freeConsent: true } : {},
  };
}

/**
 * Lê `code`, `state` e `error` do retorno. Tolera a concatenação ingênua da `callback_url` que já tem query
 * (`?state=abc?code=x`, em que o `?` extra fica dentro do valor). Valores vazios viram `null`.
 */
export function parseCallbackParams(params: URLSearchParams): { code: string | null; state: string | null; error: string | null } {
  const flat = new URLSearchParams();
  for (const [k, v] of params) {
    const [head, ...rest] = v.split("?");
    flat.append(k, head);
    for (const extra of rest) for (const [k2, v2] of new URLSearchParams(extra)) flat.append(k2, v2);
  }
  const get = (k: string) => flat.get(k) || null;
  return { code: get("code"), state: get("state"), error: get("error") };
}

function getPendingRaw(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}

function clearPending(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // sessionStorage indisponível: nada a limpar
  }
}

/**
 * Gera verifier e `state` (32 bytes aleatórios cada), guarda o pending no sessionStorage e devolve a URL de autorização.
 * O verifier nunca vai para a URL; só o challenge S256.
 */
export async function startOAuth(id: ProviderId, origin: string, intent: OAuthIntent = {}): Promise<string> {
  const flow = flowOf(id);
  const verifier = randomToken();
  const state = randomToken();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const pending: Pending = { provider: id, verifier, state, intent: intent.freeConsent ? { freeConsent: true } : {} };
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch (cause) {
    throw new AiError("unavailable", { meta: { reason: "storage" }, cause });
  }
  return flow.authorizeUrl({ redirectUri: callbackUrl(origin), challenge: base64url(new Uint8Array(digest)), state, origin });
}

/** Descarta o login em andamento (ex.: o usuário cancelou no provedor e voltou sem `code`). */
export function cancelOAuth(): void {
  clearPending();
}

/** Provedor e intenção do login em andamento, sem consumir o pending (para o título do callback). */
export function readPending(): { provider: ProviderId; intent: OAuthIntent } | null {
  const p = parsePending(getPendingRaw());
  return p ? { provider: p.provider, intent: p.intent } : null;
}

/**
 * Confere o `state` e troca o `code` pelos tokens. `state` presente tem que bater; ausente só é aceito se o flow
 * declara `stateOptional`. O pending é removido em qualquer desfecho; code, verifier,
 * state e chave nunca vão a erro ou log.
 */
export async function completeOAuth(p: {
  code: string;
  state: string | null;
  origin: string;
}): Promise<{ provider: ProviderId; tokens: OAuthTokens; intent: OAuthIntent }> {
  const pending = parsePending(getPendingRaw());
  clearPending();
  if (!pending) throw new AiError("unavailable", { meta: { reason: "missing_verifier" } });
  const flow = flowOf(pending.provider);
  const ok = p.state ? safeEqual(p.state, pending.state) : flow.stateOptional === true;
  if (!ok) throw new AiError("unavailable", { meta: { reason: "state_mismatch" } });
  const tokens = await flow.exchange({
    code: p.code,
    verifier: pending.verifier,
    redirectUri: callbackUrl(p.origin),
    origin: p.origin,
  });
  return { provider: pending.provider, tokens, intent: pending.intent };
}
