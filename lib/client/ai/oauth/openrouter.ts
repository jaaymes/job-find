import "client-only";

import { AiError } from "../errors";
import type { OAuthFlow } from "../providers";

const AUTH_URL = "https://openrouter.ai/auth";
const KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";

/**
 * Login PKCE do OpenRouter. O OpenRouter não documenta `state`, então ele vai como query dentro da `callback_url`
 * (`…/configuracoes/callback?state=…`). Como não há garantia de que a query volte, o `state` é opcional no retorno
 * (`stateOptional`): se vier, tem que bater. A chave emitida tem limite de US$ 5 e vale 1 ano.
 */
export const openRouterFlow: OAuthFlow = {
  stateOptional: true,

  authorizeUrl({ redirectUri, challenge, state }) {
    const callback = new URL(redirectUri);
    callback.searchParams.set("state", state);
    const url = new URL(AUTH_URL);
    url.searchParams.set("callback_url", callback.toString());
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("limit", "5");
    url.searchParams.set("expiration", "1-year");
    return url.toString();
  },

  /** Troca o `code` pela chave. Code, verifier e chave nunca vão a erro ou log. */
  async exchange({ code, verifier }) {
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
      const refused = res.status === 401 || res.status === 403;
      throw new AiError(refused ? "invalid_key" : "unavailable", {
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
    return { key };
  },
};
