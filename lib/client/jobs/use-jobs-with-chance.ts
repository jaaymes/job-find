import "client-only";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { profileStore } from "@/lib/client/profile/store";
import { indexProfile, scoreJob, type Band, type ScoreResult } from "@/lib/client/score/score";
import { useStore } from "@/lib/client/storage/store";
import type { JobSummary } from "@/lib/shared/types/job";
import { jobsInfiniteOptions, type JobsFilters, type JobsPage } from "./use-jobs";

/** Com o filtro de chance, cada requisição pede o máximo e o cliente descarta o que não casa (D-13). */
export const CHANCE_PAGE_LIMIT = 90;
export const CHANCE_TARGET = 30;
export const CHANCE_MAX_REQUESTS = 5;

export type ScoredJob = { job: JobSummary; chance: ScoreResult | null };

/**
 * Lista de vagas com o score local. `filters` são só os da API; `bands` é o filtro de chance
 * (aplicado aqui, no cliente). Sem perfil não há score e o filtro é ignorado. A ordem é sempre
 * a da API (da mais nova para a mais antiga), nunca a do score.
 */
export function useJobsWithChance(filters: JobsFilters, bands: Band[] | null, enabled = true) {
  const profile = useStore(profileStore);
  // Sem perfil não há score: o filtro é ignorado e a busca usa o limite padrão.
  const chanceMode = bands !== null && bands.length > 0 && profile !== null;
  const query = useInfiniteQuery({
    ...jobsInfiniteOptions(chanceMode ? { ...filters, limit: CHANCE_PAGE_LIMIT } : filters),
    enabled,
  });
  const { data, dataUpdatedAt, hasNextPage, isFetching, isPlaceholderData, fetchNextPage } = query;

  const index = useMemo(() => (profile ? indexProfile(profile) : null), [profile]);
  const filtering = chanceMode && index !== null;
  const bandKey = chanceMode ? [...bands].sort().join(",") : "";

  const scored = useMemo<ScoredJob[]>(() => {
    const now = new Date(dataUpdatedAt || 0);
    const all = (data?.pages ?? []).flatMap((p) => p.items);
    const withScore = all.map((job) => ({ job, chance: index ? scoreJob(index, job, now) : null }));
    return filtering ? withScore.filter((x) => bands.includes(x.chance!.band)) : withScore;
    // `bands` entra por `bandKey` (o array muda de identidade a cada render da URL).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dataUpdatedAt, index, filtering, bandKey]);

  // Lote atual: `target` itens a reunir e um orçamento de 5 requisições contadas a partir de `base` páginas.
  const [batch, setBatch] = useState({ target: CHANCE_TARGET, base: 0 });
  const resetKey = `${bandKey}|${filtering}|${JSON.stringify(filters)}`;
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setBatch({ target: CHANCE_TARGET, base: 0 });
  }
  const { target, base } = batch;
  const pageCount = data?.pages.length ?? 0;
  const budgetLeft = pageCount - base < CHANCE_MAX_REQUESTS;
  const searching = filtering && !isPlaceholderData && scored.length < target && Boolean(hasNextPage) && budgetLeft && !query.isError;

  // Busca mais páginas até reunir `target` itens ou gastar as 5 requisições do lote.
  useEffect(() => {
    if (searching && !isFetching) void fetchNextPage();
  }, [searching, isFetching, pageCount, fetchNextPage]);

  const loadMore = useCallback(() => {
    if (!filtering) {
      void fetchNextPage();
      return;
    }
    setBatch((b) => ({ target: b.target + CHANCE_TARGET, base: pageCount }));
  }, [filtering, fetchNextPage, pageCount]);

  const items = filtering ? scored.slice(0, target) : scored;
  const pages: JobsPage[] = data?.pages ?? [];

  return {
    items,
    hasProfile: profile !== null,
    filtering,
    isPending: query.isPending,
    isError: query.isError,
    isFetching,
    isFetchingNextPage: query.isFetchingNextPage || searching,
    hasMore: filtering ? scored.length > target || Boolean(hasNextPage) : Boolean(hasNextPage),
    loadMore,
    refetch: query.refetch,
    /** Tenta de novo a próxima página (depois de um erro com itens já na tela). */
    retryNext: () => void fetchNextPage(),
    dataUpdatedAt,
    counts: pages[0]?.counts,
    lastCollectedAt: pages[0]?.lastCollectedAt ?? null,
  };
}
