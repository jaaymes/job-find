import "client-only";
import { infiniteQueryOptions, keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import {
  createParser,
  parseAsArrayOf,
  parseAsBoolean,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { useCallback, useMemo } from "react";
import { buildJobsUrl } from "@/lib/shared/jobs-url";
import type { JobsQuery } from "@/lib/shared/schemas/jobs-query";
import type { JobSummary } from "@/lib/shared/types/job";

export type JobsPage = {
  items: JobSummary[];
  nextCursor: string | null;
  /** Só na primeira página (sem cursor). */
  counts?: { all: number; remote: number; hybrid: number; onsite: number };
  lastCollectedAt: string | null;
};

/** Filtros da URL: mesmas chaves do `JobsQuery` (sem `cursor` e `limit`, que não são estado de página). */
/** `ocultas=1` liga o filtro; qualquer outro valor (ou a ausência) o desliga. */
const parseAsFlag = createParser<true>({
  parse: (v) => (v === "1" ? true : null),
  serialize: () => "1",
});

const urlParsers = {
  q: parseAsString,
  stacks: parseAsArrayOf(parseAsString, ","),
  stacksMode: parseAsStringLiteral(["any", "all"] as const),
  origin: parseAsStringLiteral(["national", "international"] as const),
  acceptsBrazil: parseAsBoolean,
  workMode: parseAsStringLiteral(["remote", "hybrid", "onsite"] as const),
  seniority: parseAsArrayOf(parseAsStringLiteral(["intern", "junior", "mid", "senior", "lead"] as const), ","),
  lang: parseAsStringLiteral(["pt", "en", "es"] as const),
  since: parseAsStringLiteral(["24h", "7d", "30d"] as const),
  // Só do cliente: o score depende do perfil, que não sai do navegador. Nunca vai para `/api/jobs`.
  chance: parseAsArrayOf(parseAsStringLiteral(["alta", "media", "baixa"] as const), ","),
  // Só do cliente: as vagas ocultas ficam no localStorage. Na URL é `ocultas=1`.
  showHidden: parseAsFlag,
  source: parseAsArrayOf(
    parseAsStringLiteral([
      "himalayas",
      "greenhouse",
      "ashby",
      "lever",
      "jobicy",
      "github",
      "wwr",
      "remoteok",
      "hn",
      "smartrecruiters",
    ] as const),
    ",",
  ),
};

type FilterKey = keyof typeof urlParsers;
export type JobsFilters = Partial<JobsQuery>;
export type ChanceBand = "alta" | "media" | "baixa";
/** Filtros da página: os da API mais os aplicados só no cliente (chance e vagas ocultas). */
export type PageFilters = JobsFilters & { chance?: ChanceBand[]; showHidden?: true };

/** Remove tudo da URL: cada chave recebe `undefined`. */
export const CLEAR_FILTERS: PageFilters = Object.fromEntries(
  (Object.keys(urlParsers) as FilterKey[]).map((k) => [k, undefined]),
);

/** Filtros da URL (nuqs); `set` aceita um patch e `undefined` (ou lista vazia) remove a chave. */
export function useJobsFilters(): [PageFilters, (patch: PageFilters) => void] {
  const [state, setState] = useQueryStates(urlParsers, { urlKeys: { showHidden: "ocultas" } });

  const filters = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(state)) {
      if (value === null || (Array.isArray(value) && value.length === 0)) continue;
      out[key] = value;
    }
    return out as PageFilters;
  }, [state]);

  const set = useCallback(
    (patch: PageFilters) => {
      const next: Record<string, unknown> = {};
      for (const key of Object.keys(patch) as FilterKey[]) {
        if (!(key in urlParsers)) continue;
        const v = patch[key];
        const isDefault = key === "stacksMode" && v === "any";
        next[key] = v === undefined || isDefault || (Array.isArray(v) && v.length === 0) ? null : v;
      }
      void setState(next);
    },
    [setState],
  );

  return [filters, set];
}

async function fetchJobsPage(url: string, signal?: AbortSignal): Promise<JobsPage> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Falha ao carregar vagas (${res.status})`);
  }
  return (await res.json()) as JobsPage;
}

/** Opções da query infinita; separadas do hook para serem testadas sem renderizar React. */
export function jobsInfiniteOptions(filters: JobsFilters) {
  const base = buildJobsUrl({ ...filters, cursor: undefined });
  return infiniteQueryOptions({
    queryKey: ["jobs", base],
    queryFn: ({ pageParam, signal }) =>
      fetchJobsPage(buildJobsUrl({ ...filters, cursor: pageParam }), signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: JobsPage) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useJobs(filters: JobsFilters) {
  return useInfiniteQuery(jobsInfiniteOptions(filters));
}
