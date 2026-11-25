import "server-only";
import { and, eq, inArray, isNotNull, isNull, like, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db/client";
import { jobSources, jobs, sourceRuns } from "@/lib/server/db/schema";
import type { SourceId } from "@/lib/shared/types/job";

const DAY_MS = 86_400_000;
/** RF-07: vagas com mais de 45 dias saem da listagem. */
export const MAX_AGE_DAYS = 45;
/** RF-07: 3 coletas seguidas sem aparecer em nenhuma fonte. */
export const MAX_MISSED_RUNS = 3;
/** D-02: nenhuma vaga fica guardada por mais de 60 dias desde a publicação, ativa ou não. */
export const MAX_STORED_AGE_DAYS = 60;
/** D-04: vagas expiradas são apagadas depois de 30 dias. */
export const RETENTION_DAYS = 30;
/** Histórico de coletas (`source_runs`) é guardado por 30 dias. */
export const SOURCE_RUNS_RETENTION_DAYS = 30;
/** Linhas apagadas por DELETE na limpeza (mantém cada comando curto). */
export const PURGE_BATCH_SIZE = 2000;
/** Prazo total da limpeza; passou disso, devolve o que já apagou e o resto fica para o próximo dia. */
export const PURGE_TIME_LIMIT_MS = 50_000;
/** Teto do contador (smallint) para vagas que seguem presas a outra fonte. */
const MISSED_RUNS_CAP = 1000;

/** Casa `external_id` com algum dos prefixos (`LIKE '<prefixo>%'`), escapando `\`, `%` e `_` para o prefixo valer literalmente. */
function inScope(prefixes: readonly string[]) {
  const patterns = prefixes.map((p) => `${p.replace(/[\\%_]/g, "\\$&")}%`);
  // O escape padrão do LIKE no Postgres já é a barra invertida.
  return or(...patterns.map((pattern) => like(jobSources.externalId, pattern)));
}

/**
 * Conta mais uma coleta sem ver a vaga, para as `job_sources` da fonte vistas pela última vez antes
 * de `runStartedAt` (nas fontes de snapshot, o início da coleta: quem não apareceu nela). Só conta
 * quando a fonte trouxe algo e pelo menos 50% do volume anterior (coleta vazia ou parcial não
 * pode expirar nada). Fontes incrementais só chamam esta função quando declaram
 * `revisitsCatalogWithinHours`: aí `runStartedAt` é o início da coleta menos esse ciclo, e contam
 * só as vagas não vistas há mais que ele; nas demais vale só a regra dos 45 dias. Com `scopePrefixes` (conectores em rodízio), só contam as vagas
 * cujo `external_id` começa com algum prefixo, ou seja, dos boards de fato lidos nesta coleta.
 * Devolve quantas linhas foram incrementadas.
 */
export async function markMissedRuns(
  db: Db,
  source: SourceId,
  runStartedAt: Date,
  fetchedCount: number,
  previousCount: number | null,
  scopePrefixes?: readonly string[],
): Promise<number> {
  if (fetchedCount <= 0) return 0;
  if (previousCount !== null && fetchedCount < previousCount * 0.5) return 0;

  if (scopePrefixes && scopePrefixes.length === 0) return 0;

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
        ...(scopePrefixes ? [inScope(scopePrefixes)] : []),
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

/** `complete` é false quando a limpeza parou por tempo e ainda sobrou coisa para apagar. */
export type PurgeResult = { jobs: number; sourceRuns: number; complete: boolean };

/**
 * Retenção diária, em lotes: apaga (com as `job_sources`, em cascata) vagas publicadas há mais de
 * 60 dias ou expiradas há mais de 30, e `source_runs` com mais de 30 dias (inclusive as presas em
 * `running`). Para ao passar de `timeLimitMs` e devolve o que já apagou.
 */
export async function purgeOld(
  db: Db,
  now: Date,
  opts: { batchSize?: number; clock?: () => number; timeLimitMs?: number } = {},
): Promise<PurgeResult> {
  const batchSize = opts.batchSize ?? PURGE_BATCH_SIZE;
  const clock = opts.clock ?? Date.now;
  const timeLimitMs = opts.timeLimitMs ?? PURGE_TIME_LIMIT_MS;
  const start = clock();
  const outOfTime = () => clock() - start > timeLimitMs;

  const cutoffStored = new Date(now.getTime() - MAX_STORED_AGE_DAYS * DAY_MS);
  const cutoffExpired = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
  const cutoffRuns = new Date(now.getTime() - SOURCE_RUNS_RETENTION_DAYS * DAY_MS);

  let complete = true;
  let deletedJobs = 0;
  while (true) {
    if (outOfTime()) {
      complete = false;
      break;
    }
    const rows = await db
      .delete(jobs)
      .where(
        inArray(
          jobs.id,
          db
            .select({ id: jobs.id })
            .from(jobs)
            .where(or(lt(jobs.publishedAt, cutoffStored), and(isNotNull(jobs.expiredAt), lt(jobs.expiredAt, cutoffExpired))))
            .limit(batchSize),
        ),
      )
      .returning({ id: jobs.id });
    deletedJobs += rows.length;
    if (rows.length < batchSize) break;
  }

  let deletedRuns = 0;
  while (true) {
    if (outOfTime()) {
      complete = false;
      break;
    }
    const rows = await db
      .delete(sourceRuns)
      .where(
        inArray(
          sourceRuns.id,
          db.select({ id: sourceRuns.id }).from(sourceRuns).where(lt(sourceRuns.startedAt, cutoffRuns)).limit(batchSize),
        ),
      )
      .returning({ id: sourceRuns.id });
    deletedRuns += rows.length;
    if (rows.length < batchSize) break;
  }

  return { jobs: deletedJobs, sourceRuns: deletedRuns, complete };
}
