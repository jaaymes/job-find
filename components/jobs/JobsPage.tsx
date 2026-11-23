"use client";

import { SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";
import { CLEAR_FILTERS, useJobsFilters } from "@/lib/client/jobs/use-jobs";
import { useJobsWithChance } from "@/lib/client/jobs/use-jobs-with-chance";
import { FiltersPanel } from "./FiltersPanel";
import { JobCard } from "./JobCard";
import { ModeTabs } from "./ModeTabs";
import { SearchBar } from "./SearchBar";
import { StackChips } from "./StackChips";
import { formatAge, formatCollectedAt, isStale } from "./format";

const FILTERS_ID = "jobs-filters";
const SIDEBAR_KEYS = ["origin", "acceptsBrazil", "chance", "seniority", "lang", "source"] as const;

function JobCardSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3 rounded-2xl border border-jf-line bg-jf-surface p-5">
      <div className="h-3 w-32 rounded bg-jf-chip" />
      <div className="h-5 w-3/4 rounded bg-jf-chip" />
      <div className="h-4 w-1/2 rounded bg-jf-chip" />
      <div className="h-6 w-2/3 rounded bg-jf-chip" />
    </div>
  );
}

/** Mostrado no pré-render (e enquanto a URL é lida): título fixo e esqueleto da lista. */
export function JobsPageFallback() {
  return (
    <>
      <Heading lastCollectedAt={null} now={null} />
      <div aria-busy="true" className="flex flex-col gap-3.5">
        {[0, 1, 2].map((i) => (
          <JobCardSkeleton key={i} />
        ))}
      </div>
    </>
  );
}

function Heading({ lastCollectedAt, now }: { lastCollectedAt: string | null; now: number | null }) {
  return (
    <div>
      <h1 className="font-display text-[28px] font-bold tracking-tight sm:text-[34px]">Vagas de tecnologia</h1>
      <p className="mt-1.5 text-jf-ink-3">
        Brasil e exterior, de fontes abertas, da mais nova para a mais antiga.
        {lastCollectedAt && now !== null ? ` Atualizado ${formatAge(lastCollectedAt, now)}.` : ""}
      </p>
    </div>
  );
}

export function JobsPage() {
  const [filters, setFilters] = useJobsFilters();
  const { chance, ...apiFilters } = filters;
  const query = useJobsWithChance(apiFilters, chance ?? null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const panelId = useId();
  // Relógio do cliente = instante em que os dados chegaram (o pré-render não conhece a hora).
  const now = query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null;

  const items = query.items;
  const counts = query.counts;
  const lastCollectedAt = query.lastCollectedAt;
  const activeSidebar = SIDEBAR_KEYS.filter((k) => {
    const v = filters[k];
    return Array.isArray(v) ? v.length > 0 : v !== undefined;
  }).length;
  const hasAnyFilter = Object.keys(filters).length > 0;
  const clear = () => setFilters(CLEAR_FILTERS);

  return (
    <>
      <Heading lastCollectedAt={lastCollectedAt} now={now} />

      {now !== null && isStale(lastCollectedAt, now) && lastCollectedAt && (
        <p
          role="status"
          className="rounded-xl border border-jf-new-fg/20 bg-jf-new-bg px-4 py-3 text-sm text-jf-new-fg"
        >
          A última coleta de vagas foi às {formatCollectedAt(lastCollectedAt).time} de{" "}
          {formatCollectedAt(lastCollectedAt).date} (horário de Brasília), há mais de 3 h. As vagas podem estar
          desatualizadas.
        </p>
      )}

      <SearchBar filters={filters} onChange={setFilters} />
      <StackChips filters={filters} onChange={setFilters} />

      <div className="flex flex-wrap items-start gap-6">
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls={FILTERS_ID}
          onClick={() => setFiltersOpen((v) => !v)}
          className="flex min-h-10 items-center gap-2 rounded-full border border-jf-line-strong bg-jf-surface px-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-jf-brand lg:hidden"
        >
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          Filtros{activeSidebar > 0 ? ` · ${activeSidebar}` : ""}
        </button>
        <FiltersPanel
          id={FILTERS_ID}
          filters={filters}
          onChange={setFilters}
          onClear={clear}
          open={filtersOpen}
          hasProfile={query.hasProfile}
        />

        <section aria-label="Resultados" className="flex min-w-0 flex-[999_1_560px] flex-col gap-3.5">
          <ModeTabs
            value={filters.workMode}
            counts={counts}
            onChange={(workMode) => setFilters({ workMode })}
            panelId={panelId}
          />
          <p className="text-[13px] text-jf-ink-3">Ordenadas da mais nova para a mais antiga</p>

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
                  className="min-h-11 rounded-xl bg-jf-brand px-5 font-semibold text-white outline-none hover:bg-jf-brand-dark focus-visible:ring-2 focus-visible:ring-jf-brand focus-visible:ring-offset-2"
                >
                  Tentar de novo
                </button>
              </div>
            ) : query.isPending || (items.length === 0 && query.isFetchingNextPage) ? (
              [0, 1, 2, 3].map((i) => <JobCardSkeleton key={i} />)
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
                <JobCard key={job.id} job={job} chance={score} now={now ?? new Date(job.publishedAt).getTime()} />
              ))
            )}

            {query.isError && items.length > 0 && (
              <p role="alert" className="text-center text-sm text-jf-danger-fg">
                Não foi possível carregar mais vagas.
              </p>
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
          </div>
        </section>
      </div>
    </>
  );
}
