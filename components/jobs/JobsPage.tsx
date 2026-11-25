"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { CLEAR_FILTERS, serializeFilters, useJobsFilters } from "@/lib/client/jobs/use-jobs";
import { syncSnapshots, setHidden, useJobStates } from "@/lib/client/jobs/job-state";
import type { JobSummary } from "@/lib/shared/types/job";
import { isNewSince, usePreviousVisit, useRecordVisit } from "@/lib/client/jobs/last-visit";
import {
  clearSavedSearch,
  saveSearch,
  useRememberFilters,
  useRestoreFilters,
  toSavedFilters,
  useSavedFilters,
} from "@/lib/client/jobs/saved-search";
import { useMediaQuery } from "@/lib/client/use-media-query";
import { useJobsWithChance } from "@/lib/client/jobs/use-jobs-with-chance";
import { ActiveFilterChips, buildActiveChips } from "./ActiveFilterChips";
import { FiltersPanel } from "./FiltersPanel";
import { JobCard } from "./JobCard";
import { ModeTabs } from "./ModeTabs";
import { RestoredNotice } from "./RestoredNotice";
import { LinkedInSearchLink } from "./LinkedInSearchLink";
import { ResultsToolbar } from "./ResultsToolbar";
import { SearchBar } from "./SearchBar";
import { StackChips } from "./StackChips";
import { formatAge, formatCollectedAt, formatCount, isStale } from "./format";
import { SetupProgress } from "@/components/onboarding/SetupProgress";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const FILTERS_ID = "jobs-filters";
const SHEET_FILTERS_ID = "jobs-filters-sheet";
const FILTER_KEYS = ["origin", "acceptsBrazil", "chance", "seniority", "lang", "source", "since", "showHidden"] as const;
/** Abaixo de `lg` os filtros viram sheet; daí em diante, a barra lateral. */
const LG_QUERY = "(min-width: 1024px)";
const UNDO_MS = 8000;
const SAVE_ERROR = "Não foi possível salvar a busca padrão: o navegador não permitiu gravar os dados.";

function JobCardSkeleton() {
  return (
    <Skeleton className="flex flex-col gap-3 rounded-2xl border border-jf-line bg-jf-surface p-5">
      <div className="h-3 w-32 rounded bg-jf-chip" />
      <div className="h-5 w-3/4 rounded bg-jf-chip" />
      <div className="h-4 w-1/2 rounded bg-jf-chip" />
      <div className="h-6 w-2/3 rounded bg-jf-chip" />
    </Skeleton>
  );
}

const PAGE = "flex flex-col gap-3 lg:gap-4";

/** Mostrado no pré-render (e enquanto a URL é lida): título fixo e esqueleto da lista. */
export function JobsPageFallback() {
  return (
    <div className={PAGE}>
      <Heading lastCollectedAt={null} now={null} />
      <div aria-busy="true" className="flex flex-col gap-3.5">
        {[0, 1, 2].map((i) => (
          <JobCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

function Heading({ lastCollectedAt, now }: { lastCollectedAt: string | null; now: number | null }) {
  const known = lastCollectedAt !== null && now !== null;
  const collected = known && isStale(lastCollectedAt, now) ? formatCollectedAt(lastCollectedAt) : null;
  return (
    <div className="flex flex-col gap-1 lg:flex-row lg:flex-wrap lg:items-baseline lg:gap-x-4">
      <h1 className="font-display text-2xl font-bold tracking-tight lg:text-[30px]">Vagas de tecnologia</h1>
      <p className="text-sm text-jf-ink-3">
        Brasil e exterior, de fontes abertas.
        {known ? ` Atualizado ${formatAge(lastCollectedAt, now)}.` : ""}
        {collected && (
          <>
            {" "}
            <span role="status" className="font-semibold text-jf-new-fg">
              A última coleta foi às {collected.time} de {collected.date} (horário de Brasília), há mais de 3 h: as vagas
              podem estar desatualizadas.
            </span>{" "}
            <Link href="/fontes" className="font-semibold text-jf-brand underline hover:text-jf-brand-dark">
              por quê?
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

export function JobsPage() {
  const [filters, setFilters] = useJobsFilters();
  const { chance, showHidden, ...apiFilters } = filters;
  const { ready: searchReady, restored } = useRestoreFilters(filters, setFilters);
  // Guarda uma única vez os filtros restaurados: o aviso vale enquanto eles não mudarem.
  const [noticeKey, setNoticeKey] = useState<string | null>(null);
  const [noticeCaptured, setNoticeCaptured] = useState(false);
  if (searchReady && !noticeCaptured) {
    setNoticeCaptured(true);
    if (restored === "last") setNoticeKey(serializeFilters("", filters));
  }
  useRememberFilters(filters, searchReady);
  const query = useJobsWithChance(apiFilters, chance ?? null, searchReady);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const isLg = useMediaQuery(LG_QUERY);
  if (isLg && filtersOpen) setFiltersOpen(false);
  const panelId = useId();
  // Relógio do cliente = instante em que os dados chegaram (o pré-render não conhece a hora).
  const now = query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null;

  const states = useJobStates();
  const savedSearch = useSavedFilters();
  const previousVisit = usePreviousVisit();
  useRecordVisit();
  // Vagas ocultas são filtradas aqui, depois do fetch (o estado vive só no navegador): uma página pode ficar com
  // menos itens do que o limite, e o "Carregar mais vagas" continua valendo para as seguintes.
  const items = useMemo(
    () => (showHidden || !states ? query.items : query.items.filter((x) => !states[String(x.job.id)]?.hidden)),
    [query.items, states, showHidden],
  );
  const hiddenCount = query.items.length - items.length;
  // Vaga vista de novo com dados novos: atualiza a cópia guardada para "Minhas vagas".
  useEffect(() => {
    syncSnapshots(query.items.map((x) => x.job));
  }, [query.items]);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [undo, setUndo] = useState<JobSummary | null>(null);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [undo]);
  // Salvar exige ao menos um filtro além de "mostrar ocultas" (que não faz parte da busca).
  const canSaveSearch = Object.keys(filters).some((k) => k !== "showHidden");
  const counts = query.counts;
  const lastCollectedAt = query.lastCollectedAt;
  const activeCount = FILTER_KEYS.filter((k) => {
    if (k === "chance" && !query.hasProfile) return false;
    const v = filters[k];
    return Array.isArray(v) ? v.length > 0 : v !== undefined;
  }).length;
  const chips = buildActiveChips(filters, setFilters, query.hasProfile);
  // A busca por texto fica: ela tem o próprio campo e o próprio botão.
  const hasAnyFilter = Object.keys(filters).some((k) => k !== "q");
  const clear = () => setFilters({ ...CLEAR_FILTERS, q: filters.q });
  const total = counts ? counts[filters.workMode ?? "all"] : null;
  const savedSearchProps = {
    active: savedSearch !== null && toSavedFilters(savedSearch) !== null,
    canSave: canSaveSearch,
    error: saveError,
    onSave: () => {
      const r = saveSearch(filters);
      setSaveError(r.ok ? null : SAVE_ERROR);
    },
    onClear: () => {
      const r = clearSavedSearch();
      setSaveError(r.ok ? null : SAVE_ERROR);
    },
  };

  return (
    <div className={PAGE}>
      <Heading lastCollectedAt={lastCollectedAt} now={now} />

      <SearchBar filters={filters} onChange={setFilters} />
      <StackChips filters={filters} onChange={setFilters} />
      <ResultsToolbar activeCount={activeCount} total={total} onOpenFilters={() => setFiltersOpen(true)} />

      <div className="flex flex-wrap items-start gap-6">
        {isLg && (
          <FiltersPanel
            id={FILTERS_ID}
            filters={filters}
            onChange={setFilters}
            onClear={clear}
            hasProfile={query.hasProfile}
            savedSearch={savedSearchProps}
          />
        )}
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetContent
            title="Filtros"
            className="h-[90dvh]"
            footer={
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={clear}
                  className="min-h-12 shrink-0 basis-[104px] rounded-[10px] border border-jf-field-border bg-jf-surface font-semibold text-jf-ink outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-jf-brand"
                >
                  Limpar
                </button>
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="min-h-12 flex-1 rounded-[10px] bg-jf-brand text-base font-semibold text-jf-on-brand tabular-nums outline-none hover:bg-jf-brand-dark focus-visible:ring-2 focus-visible:ring-jf-brand focus-visible:ring-offset-2"
                >
                  {total !== null ? `Ver ${formatCount(total, "vaga", "vagas")}` : "Ver vagas"}
                </button>
              </div>
            }
          >
            <FiltersPanel
              id={SHEET_FILTERS_ID}
              filters={filters}
              onChange={setFilters}
              onClear={clear}
              hasProfile={query.hasProfile}
              savedSearch={savedSearchProps}
              period={filters.since}
              onPeriodChange={(since) => setFilters({ since })}
            />
          </SheetContent>
        </Sheet>

        <section aria-label="Resultados" className="flex min-w-0 flex-[999_1_560px] flex-col gap-3.5">
          <ModeTabs
            value={filters.workMode}
            counts={counts}
            onChange={(workMode) => setFilters({ workMode })}
            panelId={panelId}
          />
          {noticeKey !== null && serializeFilters("", filters) === noticeKey && <RestoredNotice onClear={clear} />}
          <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", chips.length === 0 && "max-lg:hidden")}>
            <ActiveFilterChips chips={chips} onClearAll={clear} />
            {total !== null && (
              <p className="ml-auto hidden text-[13px] text-jf-ink-3 tabular-nums lg:block">
                {formatCount(total, "resultado", "resultados")} · da mais nova para a mais antiga
              </p>
            )}
          </div>
          <SetupProgress variant="banner" />

          <div
            role="tabpanel"
            id={panelId}
            aria-labelledby={`tab-${filters.workMode ?? "all"}`}
            aria-busy={query.isFetching && !query.isFetchingNextPage}
            className="flex flex-col gap-3.5"
          >
            {query.isError && items.length === 0 ? (
              <div role="alert" className="flex flex-col items-center gap-3 rounded-2xl border border-jf-line bg-jf-surface p-8 text-center">
                <p className="font-semibold">Não foi possível carregar as vagas.</p>
                <p className="text-sm text-jf-ink-3">Verifique sua conexão e tente novamente.</p>
                <button
                  type="button"
                  onClick={() => void query.refetch()}
                  className="min-h-11 rounded-xl bg-jf-brand px-5 font-semibold text-jf-on-brand outline-none hover:bg-jf-brand-dark focus-visible:ring-2 focus-visible:ring-jf-brand focus-visible:ring-offset-2"
                >
                  Tentar de novo
                </button>
              </div>
            ) : query.isPending || (items.length === 0 && query.isFetchingNextPage) ? (
              [0, 1, 2, 3].map((i) => <JobCardSkeleton key={i} />)
            ) : items.length === 0 && hiddenCount > 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-jf-line bg-jf-surface p-8 text-center">
                <p className="font-semibold">As vagas carregadas estão ocultas</p>
                <p className="text-sm text-jf-ink-3">Você ocultou todas as vagas desta página.</p>
                <button
                  type="button"
                  onClick={() => setFilters({ showHidden: true })}
                  className="min-h-11 rounded-xl border border-jf-line-strong bg-jf-surface px-5 font-semibold outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-jf-brand"
                >
                  Mostrar vagas ocultas
                </button>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-jf-line bg-jf-surface p-8 text-center">
                <p className="font-semibold">Nenhuma vaga encontrada</p>
                <p className="text-sm text-jf-ink-3">Tente remover algum filtro ou buscar por outro termo.</p>
                {hasAnyFilter && (
                  <button
                    type="button"
                    onClick={clear}
                    className="min-h-11 rounded-xl border border-jf-line-strong bg-jf-surface px-5 font-semibold outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-jf-brand"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            ) : (
              items.map(({ job, chance: score }) => (
                <JobCard
                  key={job.id}
                  job={job}
                  chance={score}
                  isNew={isNewSince(job.publishedAt, previousVisit)}
                  now={now ?? new Date(job.publishedAt).getTime()}
                  onHidden={setUndo}
                />
              ))
            )}

            {query.isError && items.length > 0 && (
              <div role="alert" className="flex flex-col items-center gap-2 text-center">
                <p className="text-sm text-jf-danger-fg">Não foi possível carregar mais vagas.</p>
                <button
                  type="button"
                  onClick={query.retryNext}
                  className="min-h-11 rounded-xl border border-jf-line-strong bg-jf-surface px-5 font-semibold outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-jf-brand"
                >
                  Tentar de novo
                </button>
              </div>
            )}
            {query.hasMore && (
              <button
                type="button"
                disabled={query.isFetchingNextPage}
                onClick={query.loadMore}
                className="mt-2 min-h-12 self-center rounded-xl border border-jf-line-strong bg-jf-surface px-6 font-semibold outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-jf-brand disabled:opacity-60"
              >
                {query.isFetchingNextPage ? "Carregando…" : "Carregar mais vagas"}
              </button>
            )}
            {items.length > 0 && (
              <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-center text-[13px] text-jf-ink-3">
                Não achou? <LinkedInSearchLink filters={filters} />
              </p>
            )}
          </div>
        </section>
      </div>

      <div aria-live="polite" data-testid="undo-region" className="pointer-events-none fixed inset-x-4 bottom-[calc(80px+env(safe-area-inset-bottom))] z-50 md:bottom-4 flex justify-center">
        {undo && (
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl bg-jf-ink py-1.5 pr-1.5 pl-4 text-sm text-jf-surface shadow-lg">
            <span>Vaga oculta</span>
            <button
              type="button"
              onClick={() => {
                setHidden(undo, false);
                setUndo(null);
              }}
              className="min-h-11 rounded-lg px-3 font-semibold text-jf-surface underline outline-none hover:bg-jf-surface/10 focus-visible:ring-2 focus-visible:ring-jf-surface"
            >
              Desfazer
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
