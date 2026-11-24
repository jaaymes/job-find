import "server-only";
import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db/client";
import { jobSources, jobs } from "@/lib/server/db/schema";
import type { SourceId } from "@/lib/shared/types/job";

const DAY_MS = 86_400_000;
/** RF-07: vagas com mais de 45 dias saem da listagem. */
export const MAX_AGE_DAYS = 45;
/** RF-07: 3 coletas seguidas sem aparecer em nenhuma fonte. */
export const MAX_MISSED_RUNS = 3;
/** D-04: vagas expiradas são apagadas depois de 30 dias. */
export const RETENTION_DAYS = 30;
/** Teto do contador (smallint) para vagas que seguem presas a outra fonte. */
const MISSED_RUNS_CAP = 1000;

/**
 * Conta mais uma coleta sem ver a vaga, para as `job_sources` da fonte que não
 * apareceram na coleta iniciada em `runStartedAt`. Só conta quando a fonte
 * trouxe algo e pelo menos 50% do volume anterior (coleta vazia ou parcial não
 * pode expirar nada). Fontes incrementais não devem chamar esta função: nelas
 * vale só a regra dos 45 dias. Devolve quantas linhas foram incrementadas.
 */
export async function markMissedRuns(
  db: Db,
  source: SourceId,
  runStartedAt: Date,
  fetchedCount: number,
  previousCount: number | null,
): Promise<number> {
  if (fetchedCount <= 0) return 0;
  if (previousCount !== null && fetchedCount < previousCount * 0.5) return 0;

  const stale = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(isNull(jobs.expiredAt));
  const rows = await db
    .update(jobSources)
    .set({ missedRuns: sql`LEAST(${jobSources.missedRuns} + 1, ${MISSED_RUNS_CAP})` })
    .where(
      and(
        eq(jobSources.source, source),
        lt(jobSources.lastSeenAt, runStartedAt),
        inArray(jobSources.jobId, stale),
      ),
    )
    .returning({ jobId: jobSources.jobId });
  return rows.length;
}

/**
 * Expira vagas ativas com mais de 45 dias, ou que perderam 3+ coletas seguidas
 * em TODAS as suas fontes (vista em qualquer fonte, continua).
 */
export async function expireJobs(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - MAX_AGE_DAYS * DAY_MS);
  const stillSeen = db
    .select({ one: sql`1` })
    .from(jobSources)
    .where(and(eq(jobSources.jobId, jobs.id), sql`${jobSources.missedRuns} < ${MAX_MISSED_RUNS}`));
  const hasSources = db
    .select({ one: sql`1` })
    .from(jobSources)
    .where(eq(jobSources.jobId, jobs.id));

  const rows = await db
    .update(jobs)
    .set({ expiredAt: now })
    .where(
      and(
        isNull(jobs.expiredAt),
        sql`(${lt(jobs.publishedAt, cutoff)} OR (EXISTS (${hasSources}) AND NOT EXISTS (${stillSeen})))`,
      ),
    )
    .returning({ id: jobs.id });
  return rows.length;
}

/** Retenção: apaga (com as `job_sources`, em cascata) vagas expiradas há mais de 30 dias. */
export async function purgeExpired(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const rows = await db
    .delete(jobs)
    .where(and(isNotNull(jobs.expiredAt), lt(jobs.expiredAt, cutoff)))
    .returning({ id: jobs.id });
  return rows.length;
}
