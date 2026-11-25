import "client-only";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createStore, useStore, type SetResult, type Store } from "@/lib/client/storage/store";
import { jobsQuerySchema } from "@/lib/shared/schemas/jobs-query";
import { z } from "@/lib/shared/zod";
import { URL_FILTER_KEYS, type PageFilters } from "./use-jobs";

/**
 * Busca padrão (RF-22): os mesmos filtros que a URL aceita, sem `cursor`, `limit` e `ocultas` (a página e a
 * exibição de vagas ocultas não fazem parte da busca). `stacksMode` fica opcional para que ler e gravar devolvam a
 * mesma forma (o padrão `any` não é gravado).
 */
export const SavedFilters = jobsQuerySchema
  .omit({ cursor: true, limit: true, stacksMode: true })
  .extend({
    stacksMode: z.enum(["any", "all"]).optional(),
    chance: z.array(z.enum(["alta", "media", "baixa"])).optional(),
  });
export type SavedFilters = z.infer<typeof SavedFilters>;

/** `null` = sem busca padrão. Um objeto gravado que não passa no schema é descartado na leitura (vira `null`). */
export const savedFiltersStore: Store<SavedFilters | null> = createStore(
  "jobfind:v1:savedFilters",
  SavedFilters.nullable(),
  { version: 1, initial: null },
);

/** Busca padrão gravada; `null` no servidor, na hidratação e quando não há nenhuma. */
export function useSavedFilters(): SavedFilters | null {
  return useStore(savedFiltersStore);
}

/** Filtros da página que merecem ser salvos; `null` se não sobra nenhum (ou se não passam no schema). */
export function toSavedFilters(filters: PageFilters): SavedFilters | null {
  const { showHidden: _showHidden, ...rest } = filters;
  void _showHidden;
  const parsed = SavedFilters.safeParse(rest);
  if (!parsed.success) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    const isDefault = key === "stacksMode" && value === "any";
    if (value === undefined || isDefault || (Array.isArray(value) && value.length === 0)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? (out as SavedFilters) : null;
}

export const clearSavedSearch = (): SetResult => savedFiltersStore.set(null);

/** Grava a busca padrão; um conjunto de filtros vazio limpa a que existia. */
export function saveSearch(filters: PageFilters): SetResult {
  const saved = toSavedFilters(filters);
  return saved ? savedFiltersStore.set(saved) : clearSavedSearch();
}

/** A URL traz algum parâmetro de filtro? (Parâmetros alheios, como `utm_source`, não contam.) */
export function hasFilterParams(params: Pick<URLSearchParams, "has">): boolean {
  return URL_FILTER_KEYS.some((key) => params.has(key));
}

/** A busca gravada, se ainda for válida e não vazia; do contrário `null`. */
export function readSavedSearch(): SavedFilters | null {
  const saved = savedFiltersStore.get();
  return saved ? toSavedFilters(saved) : null;
}

/** Quanto tempo a última busca vale (RN-15): depois disso, vale a busca padrão. */
export const LAST_FILTERS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const LastFilters = z.object({ filters: SavedFilters, savedAt: z.iso.datetime() });

/**
 * Última busca feita (RF-10), gravada a cada mudança de filtro. Efêmera: fica fora do backup. `null` = nenhuma
 * (ou o usuário zerou os filtros); objeto fora do schema é descartado na leitura.
 */
export const lastFiltersStore: Store<{ filters: SavedFilters; savedAt: string } | null> = createStore(
  "jobfind:v1:lastFilters",
  LastFilters.nullable(),
  { version: 1, initial: null },
);

function isFresh(savedAt: string, now: number): boolean {
  const age = now - Date.parse(savedAt);
  return age <= LAST_FILTERS_TTL_MS;
}

/** A última busca, se ainda estiver dentro do prazo e não vazia; do contrário `null`. */
export function readLastFilters(now: number = Date.now()): SavedFilters | null {
  const last = lastFiltersStore.get();
  if (!last || !isFresh(last.savedAt, now)) return null;
  return toSavedFilters(last.filters);
}

/**
 * Grava a última busca quando `ready` e os filtros mudam. Antes de `ready` os filtros ainda são `{}` (a restauração
 * não aconteceu), e gravar aí apagaria a última busca. Não regrava (e não renova `savedAt`) se nada mudou.
 */
export function useRememberFilters(filters: PageFilters, ready: boolean): void {
  const serialized = JSON.stringify(toSavedFilters(filters));
  useEffect(() => {
    if (!ready) return;
    const next: SavedFilters | null = JSON.parse(serialized);
    const current = lastFiltersStore.get();
    if (next === null) {
      if (current !== null) lastFiltersStore.set(null);
      return;
    }
    const unchanged =
      current !== null &&
      JSON.stringify(toSavedFilters(current.filters)) === serialized &&
      isFresh(current.savedAt, Date.now());
    if (!unchanged) lastFiltersStore.set({ filters: next, savedAt: new Date().toISOString() });
  }, [ready, serialized]);
}

type Restored = { filters: SavedFilters; source: "last" | "saved" };

/**
 * Ao abrir a home sem nenhum filtro na URL, aplica a última busca (até 7 dias) ou, na falta dela, a busca padrão,
 * trocando a URL (replace): a URL continua sendo a fonte da verdade e pode ser compartilhada. Precedência: URL >
 * última busca > busca padrão. Só na montagem: limpar os filtros depois não os traz de volta.
 * Devolve `ready` (falso até a decisão estar tomada e a URL já refletir a busca aplicada, para a consulta de vagas
 * não sair antes sem filtros) e `restored` (qual busca foi aplicada, ou `null`).
 */
export function useRestoreFilters(
  filters: PageFilters,
  setFilters: (patch: PageFilters) => void,
): { ready: boolean; restored: "last" | "saved" | null } {
  const params = useSearchParams();
  // A home nunca é pré-renderizada (useSearchParams a deixa para o cliente), então ler a store aqui não diverge.
  const [pending] = useState<Restored | null>(() => {
    if (hasFilterParams(params)) return null;
    const last = readLastFilters();
    if (last) return { filters: last, source: "last" };
    const saved = readSavedSearch();
    return saved ? { filters: saved, source: "saved" } : null;
  });
  const [ready, setReady] = useState(pending === null);
  if (!ready && Object.keys(filters).length > 0) setReady(true);
  useEffect(() => {
    if (pending) setFilters(pending.filters);
    // Só na montagem: `setFilters` muda a cada navegação de filtro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { ready, restored: pending?.source ?? null };
}
