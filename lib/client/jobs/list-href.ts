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

type ListReturnMark = { jobId: number; len?: number };

function readMark(): ListReturnMark | null {
  const raw = window.sessionStorage.getItem(LIST_RETURN_KEY);
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) return null;
  const { jobId, len } = parsed as { jobId?: unknown; len?: unknown };
  if (typeof jobId !== "number") return null;
  return typeof len === "number" ? { jobId, len } : { jobId };
}

/** Marca que a vaga foi aberta a partir da lista (clique no título), para o "Voltar" usar o histórico. */
export function markListReturn(jobId: number): void {
  try {
    window.sessionStorage.setItem(LIST_RETURN_KEY, JSON.stringify({ jobId }));
  } catch {
    // sessionStorage indisponível: o "Voltar" cai no link com a última busca.
  }
}

/**
 * Prende a marca à entrada do histórico da vaga: na primeira montagem do detalhe, grava `len = history.length`.
 * F5 e voltar/avançar entre a lista e a vaga mantêm o mesmo `length`; qualquer navegação nova no meio (outra página e
 * de volta à vaga) o aumenta, e o "Voltar" deixa de usar o histórico.
 */
export function bindListReturn(jobId: number): void {
  try {
    const mark = readMark();
    if (mark === null || mark.jobId !== jobId || mark.len !== undefined) return;
    window.sessionStorage.setItem(LIST_RETURN_KEY, JSON.stringify({ jobId, len: window.history.length }));
  } catch {
    // sessionStorage indisponível ou marca corrompida: o "Voltar" cai no link.
  }
}

/**
 * Lê e remove a marca; `true` só se ela é desta vaga, foi presa a esta entrada do histórico (`len` igual ao
 * `history.length` atual) e há uma entrada anterior. Marca sem `len` (formato antigo ou detalhe que não montou) é
 * tratada como ausente.
 */
export function consumeListReturn(jobId: number): boolean {
  try {
    const mark = readMark();
    window.sessionStorage.removeItem(LIST_RETURN_KEY);
    if (mark === null || mark.jobId !== jobId) return false;
    const len = window.history.length;
    return mark.len === len && len > 1;
  } catch {
    try {
      window.sessionStorage.removeItem(LIST_RETURN_KEY);
    } catch {
      // nada a fazer
    }
    return false;
  }
}
