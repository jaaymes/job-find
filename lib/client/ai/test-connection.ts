import "client-only";

import { AiError, mapProviderError } from "./errors";
import type { ProviderCfg, ProviderDef } from "./providers";

const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";

/** O `/models` do OpenRouter é público e não valida a chave: o endpoint `/key` valida. */
async function checkOpenRouterKey(apiKey: string | undefined): Promise<void> {
  let res: Response;
  try {
    res = await fetch(OPENROUTER_KEY_URL, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
  } catch (cause) {
    throw new AiError("unavailable", { retryable: true, cause });
  }
  if (res.status === 401 || res.status === 403) throw new AiError("invalid_key");
  if (!res.ok) {
    throw new AiError(res.status === 429 ? "rate_limit" : "unavailable", {
      retryable: true,
      meta: { status: res.status },
    });
  }
}

/**
 * Testa a conexão sem gastar tokens: valida a chave no endpoint de chave (OpenRouter) ou
 * listando os modelos (demais provedores). Resolve em caso de sucesso; senão lança `AiError`.
 * A chave nunca vai a log nem a mensagem de erro.
 */
export async function testConnection(def: ProviderDef, cfg: ProviderCfg): Promise<void> {
  try {
    if (def.id === "openrouter") await checkOpenRouterKey(cfg.apiKey);
    else await def.listModels(cfg);
  } catch (e) {
    throw mapProviderError(e, { provider: def.id });
  }
}
