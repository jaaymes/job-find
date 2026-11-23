import "server-only";
import { desc } from "drizzle-orm";
import type { Db } from "@/lib/server/db/client";
import { sourceRuns, sourceState } from "@/lib/server/db/schema";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { FAILING_THRESHOLD, type SourceStatus } from "@/lib/shared/types/sources-status";
import type { SourceId } from "@/lib/shared/types/job";

/** Uma entrada por conector registrado; fonte sem linha de estado é `ok` com valores nulos. */
export async function listSourcesStatus(db: Db): Promise<SourceStatus[]> {
  const [states, runs] = await Promise.all([
    db.select().from(sourceState),
    // Uma linha por fonte: a execução mais recente (índice source_runs_src_idx). `error` não é selecionado de propósito.
    db
      .selectDistinctOn([sourceRuns.source], {
        source: sourceRuns.source,
        startedAt: sourceRuns.startedAt,
        status: sourceRuns.status,
        fetchedCount: sourceRuns.fetchedCount,
        newCount: sourceRuns.newCount,
      })
      .from(sourceRuns)
      .orderBy(sourceRuns.source, desc(sourceRuns.startedAt)),
  ]);
  const stateBy = new Map(states.map((s) => [s.source, s]));
  const runBy = new Map(runs.map((r) => [r.source, r]));

  return (Object.entries(CONNECTORS) as [SourceId, NonNullable<(typeof CONNECTORS)[SourceId]>][])
    .map(([source, connector]) => {
      const state = stateBy.get(source);
      const run = runBy.get(source);
      return {
        source,
        label: connector.attribution.label,
        attributionUrl: connector.attribution.url,
        dofollow: connector.attribution.dofollow,
        status: (state?.consecutiveFailures ?? 0) >= FAILING_THRESHOLD ? ("failing" as const) : ("ok" as const),
        lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
        lastRun: run
          ? {
              startedAt: run.startedAt.toISOString(),
              status: run.status,
              fetched: run.fetchedCount,
              inserted: run.newCount,
            }
          : null,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
