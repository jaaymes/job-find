import "server-only";
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { acquireLock, releaseLock } from "@/lib/server/collect/lock";
import type { Db } from "@/lib/server/db/client";
import { jobSources, jobs, sourceRuns, sourceState } from "@/lib/server/db/schema";
import { computeContentHash, enrichJob } from "@/lib/server/jobs/enrich-job";
import { expireJobs, markMissedRuns, purgeExpired } from "@/lib/server/jobs/expire";
import { upsertJob } from "@/lib/server/jobs/upsert";
import { AllBoardsFailedError } from "@/lib/server/sources/boards";
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
/** Teto de uma fonte, da busca ao fim da gravação (D-01). */
const SOURCE_SOFT_LIMIT_MS = 90_000;
/**
 * Reserva, dentro do teto da fonte e antes do abort global, para a requisição que ainda estiver em
 * andamento no prazo (timeout de 20 s do fetch seguro) e para a gravação do que foi buscado. Com
 * budgets curtos (testes) a reserva encolhe na proporção: 30 s é 1/8 do budget padrão de 240 s.
 */
const SOURCE_WRITE_RESERVE_MS = 30_000;
const WRITE_RESERVE_BUDGET_FRACTION = 1 / 8;
/** Janela de busca: o prazo entregue ao conector (`ctx.deadlineAt`) é no máximo isto depois do início. */
const SOURCE_FETCH_WINDOW_MS = SOURCE_SOFT_LIMIT_MS - SOURCE_WRITE_RESERVE_MS;
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
  /** Relógio do budget e dos prazos, em epoch ms (padrão `Date.now`; testes injetam um fixo). */
  clock?: () => number;
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
const HOUR_MS = 3_600_000;
/**
 * Maior intervalo entre coletas ok seguidas para considerar que uma fonte incremental revisitou o
 * catálogo sem parar (cron horário mais uma coleta perdida de folga).
 */
const MAX_COVERAGE_GAP_MS = 2 * HOUR_MS;

/**
 * A fonte teve coletas ok sem buracos maiores que `MAX_COVERAGE_GAP_MS` cobrindo todo o ciclo
 * anterior a `now`. Sem isso (ex.: volta de uma parada longa), as vagas ainda não revisitadas
 * pareceriam fechadas e expirariam por engano enquanto o rodízio dá a volta no catálogo.
 */
async function coveredCycle(db: Db, source: SourceId, now: Date, cycleMs: number): Promise<boolean> {
  const rows = await db
    .select({ startedAt: sourceRuns.startedAt })
    .from(sourceRuns)
    .where(
      and(
        eq(sourceRuns.source, source),
        eq(sourceRuns.status, "ok"),
        gte(sourceRuns.startedAt, new Date(now.getTime() - cycleMs - MAX_COVERAGE_GAP_MS)),
        lt(sourceRuns.startedAt, now),
      ),
    )
    .orderBy(asc(sourceRuns.startedAt));
  if (rows.length === 0 || rows[0].startedAt.getTime() > now.getTime() - cycleMs) return false;
  const times = [...rows.map((r) => r.startedAt.getTime()), now.getTime()];
  return times.every((t, i) => i === 0 || t - times[i - 1] <= MAX_COVERAGE_GAP_MS);
}

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
  opts: {
    db: Db;
    now: Date;
    conn: Connector;
    controller: AbortController;
    budgetEndsAt: number;
    tailMs: number;
    reserveMs: number;
    clock: () => number;
  },
): Promise<SourceRunResult> {
  const { db, now, conn, controller, budgetEndsAt, tailMs, reserveMs, clock } = opts;
  const source = conn.id;
  if (controller.signal.aborted) return empty(source, "skipped", `${BUDGET_ERROR} antes de iniciar`);
  // Último instante em que a busca pode terminar e ainda sobrar a reserva antes do abort global.
  const lastFetchAt = budgetEndsAt - tailMs - reserveMs;
  // Sem essa margem a fonte acabaria abortada no meio, em erro e sem gravar o cursor: nem começa.
  // Como no "antes de iniciar", nada é gravado (sem source_run, cursor ou coleta perdida).
  if (clock() >= lastFetchAt) return empty(source, "skipped", `${BUDGET_ERROR}: sem margem para buscar e gravar`);
  const remainingMs = Math.max(budgetEndsAt - clock(), 0);
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
    const scopePrefixes: string[] = [];
    const deadlineAt = Math.min(lastFetchAt, clock() + SOURCE_FETCH_WINDOW_MS);
    let cursor = state?.cursor ?? null;
    let cursorChanged = false;
    try {
      const safeFetch = createSafeFetch(conn.allowedHosts, { maxBytes: conn.maxResponseBytes });
      const ctx = {
        fetchJson: safeFetch,
        fetchText: safeFetch,
        cursor,
        setCursor(c: string | null) {
          cursor = c;
          cursorChanged = true;
        },
        reportPartial(label: string, error: unknown) {
          partialBoards.push(`${label}: ${shortError(error)}`);
          console.warn(`[coleta] ${source}: falha parcial em ${label}: ${shortError(error)}`);
        },
        reportScope(prefixes: readonly string[]) {
          scopePrefixes.push(...prefixes);
        },
        deadlineAt,
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
        .set({
          consecutiveFailures: (state?.consecutiveFailures ?? 0) + 1,
          // Janela inteira de boards falhou: avança o rodízio para não repetir a mesma janela.
          ...(cursorChanged && e instanceof AllBoardsFailedError ? { cursor } : {}),
        })
        .where(eq(sourceState.source, source));
      return { source, status: "error", ...counts, expired: 0, error: message };
    }

    // Fonte de snapshot completo: o que não apareceu conta uma coleta perdida. Com escopo (conectores
    // em rodízio), só valem os boards lidos por completo, então falha parcial em outros boards não
    // atrapalha e a guarda de volume anterior não se aplica. Sem escopo, uma falha parcial deixa o
    // snapshot incompleto e nada conta como perdido.
    if (conn.fullSnapshot) {
      if (scopePrefixes.length > 0) {
        await markMissedRuns(db, source, now, counts.fetched, null, scopePrefixes);
      } else if (partialBoards.length === 0) {
        await markMissedRuns(db, source, now, counts.fetched, state?.lastFetchedCount ?? null);
      }
    } else if (conn.revisitsCatalogWithinHours) {
      // Fonte incremental que revisita o catálogo inteiro nesse ciclo: o que não foi visto desde
      // antes dele fechou na origem e conta coleta perdida (coleta vazia não conta nada). Só vale
      // se a fonte coletou sem parar durante o ciclo todo (ver `coveredCycle`).
      const cycleMs = conn.revisitsCatalogWithinHours * HOUR_MS;
      if (await coveredCycle(db, source, now, cycleMs)) {
        await markMissedRuns(db, source, new Date(now.getTime() - cycleMs), counts.fetched, null);
      }
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
    clock = Date.now,
  } = opts;

  // Um único relógio para a execução inteira; as fontes param TAIL_MARGIN_MS antes do fim.
  const budgetEndsAt = clock() + budgetMs;
  const tailMs = Math.min(TAIL_MARGIN_MS, budgetMs / 10);
  const reserveMs = Math.min(SOURCE_WRITE_RESERVE_MS, budgetMs * WRITE_RESERVE_BUDGET_FRACTION);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(BUDGET_ERROR)), budgetMs - tailMs);

  const settled = await allSettledLimited(
    sources.map((source) => async (): Promise<SourceRunResult> => {
      const conn = connectors[source];
      if (!conn) return empty(source, "error", `conector não encontrado para a fonte ${source}`);
      return runSource({ db, now, conn, controller, budgetEndsAt, tailMs, reserveMs, clock });
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
  // O status das fontes muda a cada execução (falhas seguidas, última coleta): o cache de 5 min não deve esperar.
  if (results.length > 0) {
    try {
      await invalidate("sources-status");
    } catch (e) {
      console.error(`[coleta] falha ao invalidar o cache de status: ${describeError(e)}`);
    }
  }
  return results;
}
