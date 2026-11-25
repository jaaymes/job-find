import type { ModelInfo, ProviderId } from "@/lib/client/ai/providers";

/** Modelo de um provedor conectado; o mesmo `id` pode existir em mais de um provedor. */
export type ModelOption = ModelInfo & { provider: ProviderId };

/** Minúsculas e sem acento: "Gêmini" vira "gemini". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Busca no nome, no id e no nome do provedor, ignorando caixa e acento. */
export function matchesModel(model: ModelOption, query: string, providerLabel: string): boolean {
  return fold(`${model.label} ${model.id} ${providerLabel}`).includes(fold(query.trim()));
}

/** Chave única da opção (provedor + id), pois o id sozinho repete entre provedores. */
export function optionKey(o: ModelOption): string {
  return `${o.provider}:${o.id}`;
}
