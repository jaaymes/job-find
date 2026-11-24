import "client-only";

import type { LanguageModel } from "ai";
import { AiError } from "./errors";
import { isFreeModel, PROVIDER_IDS, PROVIDERS, type AiTask, type ProviderDef, type ProviderId } from "./providers";
import type { AiSettings } from "./settings";

export function isConnected(s: AiSettings, id: ProviderId): boolean {
  const cfg = s.providers[id];
  if (!cfg) return false;
  return id === "local" ? Boolean(cfg.baseURL) : Boolean(cfg.key);
}

/** Provedor com aviso de privacidade que o usuário ainda não aceitou. */
function needsPrivacyAck(s: AiSettings, id: ProviderId): boolean {
  return PROVIDERS[id].privacyNote !== null && s.providers[id]?.privacyAccepted !== true;
}

/** Modelo gratuito do OpenRouter sem o aviso dos gratuitos aceito. */
function needsFreeAck(s: AiSettings, id: ProviderId, modelId: string): boolean {
  return id === "openrouter" && isFreeModel(modelId) && s.providers.openrouter?.freeConsent !== true;
}

/** Provedor conectado e liberado para rodar este modelo. */
function usable(s: AiSettings, id: ProviderId, modelId: string): boolean {
  return isConnected(s, id) && !needsPrivacyAck(s, id) && !needsFreeAck(s, id, modelId);
}

/**
 * Há como rodar a tarefa agora? Mesma regra do `resolveTaskModel`: com escolha explícita, o provedor
 * escolhido precisa estar conectado e com o aviso de privacidade aceito; sem escolha, basta algum
 * provedor conectado e liberado.
 */
export function hasUsableProvider(s: AiSettings, task: AiTask): boolean {
  const choice = s.tasks[task];
  if (choice) return usable(s, choice.provider, choice.model);
  return PROVIDER_IDS.some((p) => usable(s, p, PROVIDERS[p].defaultModels[task]));
}

/**
 * Resolve o modelo de uma tarefa. Usa a escolha explícita da tarefa; sem ela, cai no
 * primeiro provedor conectado (ordem do registro) com o modelo padrão da tarefa.
 * Provedores com `privacyNote` sem `privacyAccepted` são pulados no fallback e bloqueiam a escolha
 * explícita (`blocked_by_privacy`). Lança `AiError('no_provider')` quando nada está disponível.
 */
export async function resolveTaskModel(
  s: AiSettings,
  task: AiTask,
): Promise<{ model: LanguageModel; provider: ProviderDef; modelId: string }> {
  const choice = s.tasks[task];
  let id: ProviderId;
  let modelId: string;
  if (choice) {
    if (!isConnected(s, choice.provider)) throw new AiError("no_provider");
    if (needsPrivacyAck(s, choice.provider)) {
      throw new AiError("blocked_by_privacy", { meta: { provider: choice.provider } });
    }
    if (needsFreeAck(s, choice.provider, choice.model)) {
      throw new AiError("blocked_by_privacy", { meta: { provider: choice.provider, reason: "free_models" } });
    }
    id = choice.provider;
    modelId = choice.model;
  } else {
    const first = PROVIDER_IDS.find((p) => usable(s, p, PROVIDERS[p].defaultModels[task]));
    if (!first) throw new AiError("no_provider");
    id = first;
    modelId = PROVIDERS[first].defaultModels[task];
  }
  const provider = PROVIDERS[id];
  const cfg = s.providers[id];
  const sdk = await provider.create({ apiKey: cfg?.key, baseURL: cfg?.baseURL });
  return { model: sdk.languageModel(modelId), provider, modelId };
}
