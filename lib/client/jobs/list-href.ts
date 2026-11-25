import "client-only";

import { useStore } from "@/lib/client/storage/store";
import { lastFiltersStore, readLastFilters } from "./saved-search";
import { serializeFilters } from "./use-jobs";

const LIST_RETURN_KEY = "jobfind:session:listReturn";

/**
 * Endereço da lista de vagas com a última busca (RF-11). `"/"` no servidor, na hidratação e quando não há busca
 * válida (vazia ou com mais de 7 dias).
 */
export function useJobsListHref(): string {
  const last = useStore(lastFiltersStore);
  if (last === null) return "/";
  const filters = readLastFilters();
  return filters ? serializeFilters("/", filters) : "/";
}

/** Marca que a vaga foi aberta a partir da lista (clique no título), para o "Voltar" usar o histórico. */
export function markListReturn(jobId: number): void {
  try {
    window.sessionStorage.setItem(LIST_RETURN_KEY, JSON.stringify({ jobId }));
  } catch {
    // sessionStorage indisponível: o "Voltar" cai no link com a última busca.
  }
}

/** Lê e remove a marca; `true` só se ela é desta vaga. */
export function consumeListReturn(jobId: number): boolean {
  try {
    const raw = window.sessionStorage.getItem(LIST_RETURN_KEY);
    if (raw === null) return false;
    window.sessionStorage.removeItem(LIST_RETURN_KEY);
    const parsed: unknown = JSON.parse(raw);
    return (
      typeof parsed === "object" && parsed !== null && (parsed as { jobId?: unknown }).jobId === jobId
    );
  } catch {
    return false;
  }
}
