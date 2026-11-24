import "client-only";

import type { OAuthFlow } from "../providers";

const NAO_IMPLEMENTADO = "Fluxo OAuth genérico do OpenRouter ainda não implementado.";

/**
 * Fluxo provisório: a UI ainda chama `startOpenRouterAuth`/`completeOpenRouterAuth` (pkce.ts) diretamente.
 * Substituído pelo fluxo genérico na próxima tarefa.
 */
export const openRouterFlow: OAuthFlow = {
  authorizeUrl() {
    throw new Error(NAO_IMPLEMENTADO);
  },
  async exchange() {
    throw new Error(NAO_IMPLEMENTADO);
  },
};
