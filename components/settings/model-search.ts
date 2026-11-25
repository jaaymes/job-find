import type { ModelInfo, ProviderId } from "@/lib/client/ai/providers";

/** Modelo de um provedor conectado; o mesmo `id` pode existir em mais de um provedor. */
export type ModelOption = ModelInfo & { provider: ProviderId };

/** Minúsculas e sem acento: "Gêmini" vira "gemini". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Texto de busca já dobrado (nome, id e provedor): calcule uma vez por lista, não a cada tecla. */
export function searchText(model: ModelOption, providerLabel: string): string {
  return fold(`${model.label} ${model.id} ${providerLabel}`);
}

/** Consulta dobrada, para comparar com `searchText`. */
export function foldQuery(query: string): string {
  return fold(query.trim());
}

/** Compara textos já dobrados por `searchText` e `foldQuery`. */
export function matchesSearchText(text: string, foldedQuery: string): boolean {
  return text.includes(foldedQuery);
}

/** Busca no nome, no id e no nome do provedor, ignorando caixa e acento. */
export function matchesModel(model: ModelOption, query: string, providerLabel: string): boolean {
  return matchesSearchText(searchText(model, providerLabel), foldQuery(query));
}

/** Chave única da opção (provedor + id), pois o id sozinho repete entre provedores. */
export function optionKey(o: ModelOption): string {
  return `${o.provider}:${o.id}`;
}
