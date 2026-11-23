import "client-only";

import type { LanguageModel } from "ai";
import { AiError } from "./errors";
import { PROVIDER_IDS, PROVIDERS, type AiTask, type ProviderDef, type ProviderId } from "./providers";
import type { AiSettings } from "./settings";

function isConnected(s: AiSettings, id: ProviderId): boolean {
  const cfg = s.providers[id];
  if (!cfg) return false;
  return id === "local" ? Boolean(cfg.baseURL) : Boolean(cfg.key);
}

/**
 * Resolve o modelo de uma tarefa. Usa a escolha explícita da tarefa; sem ela, cai no
 * primeiro provedor conectado (ordem do registro) com o modelo padrão da tarefa.
 * Lança `AiError('no_provider')` quando nada está conectado.
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
    id = choice.provider;
    modelId = choice.model;
  } else {
    const first = PROVIDER_IDS.find((p) => isConnected(s, p));
    if (!first) throw new AiError("no_provider");
    id = first;
    modelId = PROVIDERS[first].defaultModels[task];
  }
  const provider = PROVIDERS[id];
  const cfg = s.providers[id];
  const sdk = await provider.create({ apiKey: cfg?.key, baseURL: cfg?.baseURL });
  return { model: sdk.languageModel(modelId), provider, modelId };
}
