import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { acquireLock, releaseLock } from "@/lib/server/collect/lock";
import type { Db } from "@/lib/server/db/client";
import { jobSources, jobs, sourceRuns, sourceState } from "@/lib/server/db/schema";
import { computeContentHash, enrichJob } from "@/lib/server/jobs/enrich-job";
import { expireJobs, markMissedRuns, purgeExpired } from "@/lib/server/jobs/expire";
import { upsertJob } from "@/lib/server/jobs/upsert";
import { createSafeFetch } from "@/lib/server/sources/http";
import { CONNECTORS } from "@/lib/server/sources/registry";
import type { Connector, NormalizedJob } from "@/lib/server/sources/types";
import type { SourceId } from "@/lib/shared/types/job";

const DEFAULT_BUDGET_MS = 240_000;
const DEFAULT_CONCURRENCY = 5;
const BATCH_SIZE = 100;
/** Folga do lock além do budget, para o lock nunca vencer antes da coleta terminar. */
const LOCK_MARGIN_MS = 60_000;
/** Tolerância para o cron disparar alguns segundos antes do intervalo mínimo. */
const INTERVAL_TOLERANCE_MS = 60_000;
/** Reserva no fim do budget para expireJobs/retenção/invalidação: as fontes são cortadas antes. */
const TAIL_MARGIN_MS = 5_000;
const MAX_ERROR_LENGTH = 500;
/** Quantas falhas (boards ou vagas) entram, com detalhe, no resumo de `source_runs.error`. */
const MAX_LISTED_FAILURES = 5;
const MAX_FAILURE_DETAIL = 120;
/** A retenção (DELETE diário) roda na execução das 03:17 UTC (cron da Vercel é UTC). */
const PURGE_HOUR_UTC = 3;

export type SourceRunResult = {
  source: SourceId;
  status: "ok" | "error" | "skipped";
  fetched: number;
  inserted: number;
  updated: number;
  /** Vagas vistas de novo sem mudança (atalho do hash ou upsert sem alteração). */
  unchanged: number;
  expired: number;
  /** Vagas individuais que falharam no upsert (a fonte segue 'ok'). */
  errors: number;
  /** Com status 'error', o motivo; com 'ok', o resumo das falhas parciais (o mesmo de `source_runs.error`). */
  error?: string;
};

export type RunCollectionOptions = {
  db: Db;
  sources: SourceId[];
  now: Date;
  budgetMs?: number;
  concurrency?: number;
  connectors?: Partial<Record<SourceId, Connector>>;
  invalidate?: (tag: string) => Promise<void>;
};

const empty = (source: SourceId, status: SourceRunResult["status"], error?: string): SourceRunResult => ({
  source,
  status,
  fetched: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  expired: 0,
  errors: 0,
  ...(error ? { error } : {}),
});

function describeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.slice(0, MAX_ERROR_LENGTH);
}

/** "Classe: mensagem", curto, para os resumos de falha parcial. */
function shortError(e: unknown): string {
  const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return text.replace(/\s+/g, " ").slice(0, MAX_FAILURE_DETAIL);
}

function listFailures(title: string, items: string[]): string {
  const shown = items.slice(0, MAX_LISTED_FAILURES).join("; ");
  const more = items.length > MAX_LISTED_FAILURES ? `; +${items.length - MAX_LISTED_FAILURES}` : "";
  return `${items.length} ${title}: ${shown}${more}`;
}

/** Resumo das falhas parciais de uma coleta ok (boards e vagas), ou `null` se não houve. */
function partialSummary(boards: string[], jobErrors: string[], errorCount: number): string | null {
  const parts: string[] = [];
  if (boards.length > 0) parts.push(listFailures("board(s) com falha", boards));
  if (errorCount > 0) {
    const listed = jobErrors.length < errorCount ? [...jobErrors, `+${errorCount - jobErrors.length}`] : jobErrors;
    parts.push(`${errorCount} vaga(s) com erro: ${listed.join("; ")}`);
  }
  return parts.length > 0 ? parts.join(" | ").slice(0, MAX_ERROR_LENGTH) : null;
}

const BUDGET_ERROR = "budget esgotado";

/** Itera o conector sem ficar preso: a corrida com o sinal corta até quem ignora o abort. */
async function* withAbort<T>(iterable: AsyncIterable<T>, signal: AbortSignal): AsyncGenerator<T> {
  const it = iterable[Symbol.asyncIterator]();
  const aborted = new Promise<never>((_, reject) => {
    const fail = () => reject(new Error(BUDGET_ERROR));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
  aborted.catch(() => undefined);
  try {
    for (;;) {
      const step = await Promise.race([it.next(), aborted]);
      if (step.done) return;
      yield step.value;
    }
  } finally {
    // Não espera o conector: ele pode estar pendurado numa promessa que nunca resolve.
    void Promise.resolve(it.return?.()).catch(() => undefined);
  }
}

type Counts = { fetched: number; inserted: number; updated: number; unchanged: number; errors: number };
/** Primeiras falhas de upsert, "external_id: Classe: mensagem", para o resumo em `source_runs.error`. */
type JobErrors = string[];

async function processBatch(
  db: Db,
  conn: Connector,
  raws: unknown[],
  now: Date,
  counts: Counts,
  jobErrors: JobErrors,
): Promise<void> {
  const normalized: NormalizedJob[] = [];
  for (const raw of raws) {
    const n = conn.normalize(raw);
    if (n) normalized.push(n);
  }
  if (normalized.length === 0) return;
  const src = { id: conn.id, brazilian: conn.brazilian, dofollow: conn.attribution.dofollow };

  await db.transaction(async (tx) => {
    // Uma consulta por lote: hash, HTML já sanitizado e URL da fonte, para decidir o atalho.
    const prevRows = await tx
      .select({
        externalId: jobSources.externalId,
        url: jobSources.url,
        contentHash: jobs.contentHash,
        descriptionHtml: jobs.descriptionHtml,
        expiredAt: jobs.expiredAt,
      })
      .from(jobSources)
      .innerJoin(jobs, eq(jobs.id, jobSources.jobId))
      .where(
        and(
          eq(jobSources.source, conn.id),
          inArray(
            jobSources.externalId,
            normalized.map((n) => n.externalId),
          ),
        ),
      );
    const prevByExternal = new Map(prevRows.map((r) => [r.externalId, r]));

    // Atalho: mesma publicação, ativa, com o mesmo hash (que inclui a versão do sanitizador) e a
    // mesma URL na fonte. Nada a enriquecer nem regravar: só renova a presença, num UPDATE por lote.
    const unchangedIds: string[] = [];
    for (const n of normalized) {
      try {
        const hash = computeContentHash(n);
        const prev = prevByExternal.get(n.externalId) ?? null;
        if (prev && prev.expiredAt === null && prev.contentHash === hash && prev.url === n.url) {
          unchangedIds.push(n.externalId);
          continue;
        }
        const enriched = enrichJob(n, src, prev && { contentHash: prev.contentHash, descriptionHtml: prev.descriptionHtml }, hash);
        if (!enriched) continue;
        // Savepoint: se o upsert falhar (ex.: 23505), só esta vaga é desfeita.
        const { status } = await tx.transaction((sp) =>
          upsertJob(sp, enriched, { source: conn.id, externalId: n.externalId, url: n.url }, now),
        );
        if (status === "inserted") counts.inserted += 1;
        else if (status === "updated") counts.updated += 1;
        else if (status === "unchanged") counts.unchanged += 1;
      } catch (e) {
        counts.errors += 1;
        if (jobErrors.length < MAX_LISTED_FAILURES) jobErrors.push(`${n.externalId}: ${shortError(e)}`);
        console.error(`[coleta] ${conn.id}: falha ao gravar a vaga ${n.externalId}: ${describeError(e)}`);
      }
    }

    if (unchangedIds.length > 0) {
      // Mesma semântica do upsert para markMissedRuns/expiração: vista agora, nenhuma coleta perdida.
      await tx
        .update(jobSources)
        .set({ lastSeenAt: now, missedRuns: 0 })
        .where(and(eq(jobSources.source, conn.id), inArray(jobSources.externalId, unchangedIds)));
      counts.unchanged += unchangedIds.length;
    }
  });
}

async function runSource(
  opts: { db: Db; now: Date; conn: Connector; controller: AbortController; budgetEndsAt: number },
): Promise<SourceRunResult> {
  const { db, now, conn, controller, budgetEndsAt } = opts;
  const source = conn.id;
  if (controller.signal.aborted) return empty(source, "skipped", `${BUDGET_ERROR} antes de iniciar`);
  const remainingMs = Math.max(budgetEndsAt - Date.now(), 0);
  if (!(await acquireLock(db, source, remainingMs + LOCK_MARGIN_MS))) return empty(source, "skipped");

  let runId: number | null = null;
  try {
    const [state] = await db.select().from(sourceState).where(eq(sourceState.source, source));

    if (conn.minIntervalMinutes > 0) {
      const [last] = await db
        .select({ startedAt: sourceRuns.startedAt })
        .from(sourceRuns)
        .where(and(eq(sourceRuns.source, source), eq(sourceRuns.status, "ok")))
        .orderBy(desc(sourceRuns.startedAt))
        .limit(1);
      const minMs = conn.minIntervalMinutes * 60_000 - INTERVAL_TOLERANCE_MS;
      if (last && now.getTime() - last.startedAt.getTime() < minMs) return empty(source, "skipped");
    }

    const [run] = await db
      .insert(sourceRuns)
      .values({ source, startedAt: now, status: "running" })
      .returning({ id: sourceRuns.id });
    runId = run.id;

    const counts: Counts = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, errors: 0 };
    const jobErrors: JobErrors = [];
    const partialBoards: string[] = [];
    let cursor = state?.cursor ?? null;
    let cursorChanged = false;
    try {
      const ctx = {
        fetchJson: createSafeFetch(conn.allowedHosts),
        fetchText: createSafeFetch(conn.allowedHosts),
        cursor,
        setCursor(c: string | null) {
          cursor = c;
          cursorChanged = true;
        },
        reportPartial(label: string, error: unknown) {
          partialBoards.push(`${label}: ${shortError(error)}`);
          console.warn(`[coleta] ${source}: falha parcial em ${label}: ${shortError(error)}`);
        },
        signal: controller.signal,
        now,
      };
      let batch: unknown[] = [];
      for await (const raw of withAbort(conn.fetch(ctx), controller.signal)) {
        counts.fetched += 1;
        batch.push(raw);
        if (batch.length >= BATCH_SIZE) {
          await processBatch(db, conn, batch, now, counts, jobErrors);
          batch = [];
        }
      }
      if (controller.signal.aborted) throw new Error(BUDGET_ERROR);
      if (batch.length > 0) await processBatch(db, conn, batch, now, counts, jobErrors);
    } catch (e) {
      const message = describeError(e);
      await db
        .update(sourceRuns)
        .set({
          status: "error",
          finishedAt: new Date(),
          fetchedCount: counts.fetched,
          newCount: counts.inserted,
          updatedCount: counts.updated,
          expiredCount: 0,
          error: message,
        })
        .where(eq(sourceRuns.id, runId));
      await db
        .update(sourceState)
        .set({ consecutiveFailures: (state?.consecutiveFailures ?? 0) + 1 })
        .where(eq(sourceState.source, source));
      return { source, status: "error", ...counts, expired: 0, error: message };
    }

    // Fonte de snapshot completo: o que não apareceu conta uma coleta perdida. Com falha parcial
    // (ex.: um board fora do ar), o snapshot está incompleto e nada conta como perdido.
    if (conn.fullSnapshot && partialBoards.length === 0) {
      await markMissedRuns(db, source, now, counts.fetched, state?.lastFetchedCount ?? null);
    }
    const partial = partialSummary(partialBoards, jobErrors, counts.errors);
    await db
      .update(sourceState)
      .set({
        lastSuccessAt: now,
        lastFetchedCount: counts.fetched,
        consecutiveFailures: 0,
        ...(cursorChanged ? { cursor } : {}),
      })
      .where(eq(sourceState.source, source));
    await db
      .update(sourceRuns)
      .set({
        status: "ok",
        finishedAt: new Date(),
        fetchedCount: counts.fetched,
        newCount: counts.inserted,
        updatedCount: counts.updated,
        expiredCount: 0,
        error: partial,
      })
      .where(eq(sourceRuns.id, runId));
    return { source, status: "ok", ...counts, expired: 0, ...(partial ? { error: partial } : {}) };
  } finally {
    await releaseLock(db, source).catch((e: unknown) =>
      console.error(`[coleta] ${source}: falha ao liberar o lock: ${describeError(e)}`),
    );
  }
}

/** Limitador simples: no máximo `limit` tarefas em voo, resultados na ordem de entrada. */
async function allSettledLimited<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]().then(
        (value) => ({ status: "fulfilled", value }) as const,
        (reason: unknown) => ({ status: "rejected", reason }) as const,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), tasks.length) }, worker));
  return results;
}

/** Orquestra a coleta (RF-01, RNF-03/04, D-07): fontes isoladas, lock, log em `source_runs`, expiração. */
export async function runCollection(opts: RunCollectionOptions): Promise<SourceRunResult[]> {
  const {
    db,
    sources,
    now,
    budgetMs = DEFAULT_BUDGET_MS,
    concurrency = DEFAULT_CONCURRENCY,
    connectors = CONNECTORS,
    invalidate = async () => undefined,
  } = opts;

  // Um único relógio para a execução inteira; as fontes param TAIL_MARGIN_MS antes do fim.
  const budgetEndsAt = Date.now() + budgetMs;
  const tailMs = Math.min(TAIL_MARGIN_MS, budgetMs / 10);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(BUDGET_ERROR)), budgetMs - tailMs);

  const settled = await allSettledLimited(
    sources.map((source) => async (): Promise<SourceRunResult> => {
      const conn = connectors[source];
      if (!conn) return empty(source, "error", `conector não encontrado para a fonte ${source}`);
      return runSource({ db, now, conn, controller, budgetEndsAt });
    }),
    concurrency,
  ).finally(() => clearTimeout(timer));
  const results = settled.map((s, i): SourceRunResult =>
    s.status === "fulfilled" ? s.value : empty(sources[i], "error", describeError(s.reason)),
  );

  let changed = results.some((r) => r.inserted > 0 || r.updated > 0);
  try {
    if ((await expireJobs(db, now)) > 0) changed = true;
    if (now.getUTCHours() === PURGE_HOUR_UTC && (await purgeExpired(db, now)) > 0) changed = true;
  } catch (e) {
    console.error(`[coleta] falha na expiração/retenção: ${describeError(e)}`);
  }

  if (changed) {
    try {
      await invalidate("jobs");
    } catch (e) {
      console.error(`[coleta] falha ao invalidar o cache: ${describeError(e)}`);
    }
  }
  return results;
}
