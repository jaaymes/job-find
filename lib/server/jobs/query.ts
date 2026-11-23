import "server-only";
import { and, arrayContains, arrayOverlaps, desc, eq, gte, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/lib/server/db/client";
import { jobs, jobSources } from "@/lib/server/db/schema";
import type { JobsQuery } from "@/lib/shared/schemas/jobs-query";
import type { JobAttribution, JobDetail, JobSummary, SourceId } from "@/lib/shared/types/job";
import { decodeCursor, encodeCursor } from "./cursor";

export type JobCounts = { all: number; remote: number; hybrid: number; onsite: number };

export type ListJobsResult = {
  items: JobSummary[];
  nextCursor: string | null;
  counts?: JobCounts;
};

export type AttributionFor = (source: SourceId) => { label: string; dofollow: boolean } | null;

const SINCE_MS = { "24h": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 } as const;

// Mesmas configurações usadas em `job_search_vector` (spec 5.2): `simple` cobre
// título/empresa/stacks; as demais cobrem o corpo na língua da vaga.
const FTS_CONFIGS = ["simple", "portuguese", "english", "spanish"] as const;

const summaryColumns = {
  id: jobs.id,
  title: jobs.title,
  company: jobs.company,
  companyLogoUrl: jobs.companyLogoUrl,
  summary: jobs.summary,
  country: jobs.country,
  city: jobs.city,
  origin: jobs.origin,
  acceptsBrazil: jobs.acceptsBrazil,
  workMode: jobs.workMode,
  seniority: jobs.seniority,
  language: jobs.language,
  stacks: jobs.stacks,
  sources: jobs.sources,
  salaryMin: jobs.salaryMin,
  salaryMax: jobs.salaryMax,
  salaryCurrency: jobs.salaryCurrency,
  salaryPeriod: jobs.salaryPeriod,
  publishedAt: jobs.publishedAt,
};

type SummaryRow = Omit<JobSummary, "salaryMin" | "salaryMax" | "publishedAt"> & {
  salaryMin: string | null;
  salaryMax: string | null;
  publishedAt: Date;
};

function toNumber(v: string | null): number | null {
  return v === null ? null : Number(v);
}

function toSummary(r: SummaryRow): JobSummary {
  return {
    ...r,
    salaryMin: toNumber(r.salaryMin),
    salaryMax: toNumber(r.salaryMax),
    publishedAt: r.publishedAt.toISOString(),
  };
}

/** Só inclui os predicados dos filtros presentes (sem `$x IS NULL OR`). */
function filterPredicates(q: JobsQuery, now: number): SQL[] {
  const p: SQL[] = [isNull(jobs.expiredAt)];
  if (q.q) {
    const term = q.q;
    const matches = FTS_CONFIGS.map(
      (cfg) =>
        sql`${jobs.searchVector} @@ websearch_to_tsquery(${sql.raw(`'${cfg}'`)}::regconfig, f_unaccent(${term}))`,
    );
    const any = or(...matches);
    if (any) p.push(any);
  }
  if (q.stacks && q.stacks.length > 0) {
    p.push(q.stacksMode === "all" ? arrayContains(jobs.stacks, q.stacks) : arrayOverlaps(jobs.stacks, q.stacks));
  }
  if (q.origin) p.push(eq(jobs.origin, q.origin));
  if (q.acceptsBrazil !== undefined) p.push(eq(jobs.acceptsBrazil, q.acceptsBrazil));
  if (q.seniority && q.seniority.length > 0) p.push(inArray(jobs.seniority, q.seniority));
  if (q.lang) p.push(eq(jobs.language, q.lang));
  if (q.since) p.push(gte(jobs.publishedAt, new Date(now - SINCE_MS[q.since])));
  if (q.source && q.source.length > 0) p.push(arrayOverlaps(jobs.sources, q.source));
  return p;
}

type Batchable = Db & { batch(queries: unknown[]): Promise<unknown[]> };

function hasBatch(db: Db): db is Batchable {
  return "batch" in db && typeof db.batch === "function";
}

const SET_TIMEOUT = sql`SET LOCAL statement_timeout = '3s'`;

/**
 * Roda as consultas com `statement_timeout` de 3 s. `SET LOCAL` só vale dentro
 * de uma transação: no neon-http, `db.batch()` já roda tudo em uma transação;
 * nos drivers de pool usamos `db.transaction`. O resultado é o mesmo.
 */
async function runWithTimeout<I extends PromiseLike<unknown>, C extends PromiseLike<unknown>>(
  db: Db,
  build: (d: Db) => { items: I; counts?: C },
): Promise<{ items: Awaited<I>; counts?: Awaited<C> }> {
  if (hasBatch(db)) {
    const { items, counts } = build(db);
    const res = await db.batch([db.execute(SET_TIMEOUT), items, ...(counts ? [counts] : [])]);
    return { items: res[1] as Awaited<I>, counts: counts ? (res[2] as Awaited<C>) : undefined };
  }
  return db.transaction(async (tx) => {
    await tx.execute(SET_TIMEOUT);
    const { items, counts } = build(tx);
    // Sequencial: uma transação usa uma única conexão.
    const itemsRes = await items;
    const countsRes = counts ? await counts : undefined;
    return { items: itemsRes, counts: countsRes };
  });
}

export async function listJobs(db: Db, q: JobsQuery, withCounts: boolean): Promise<ListJobsResult> {
  const now = Date.now();
  const base = filterPredicates(q, now);
  const pagePredicates = [...base];
  const cursor = q.cursor ? decodeCursor(q.cursor) : null;
  if (cursor) {
    pagePredicates.push(
      sql`(${jobs.publishedAt}, ${jobs.id}) < (${cursor.publishedAt.toISOString()}::timestamptz, ${cursor.id})`,
    );
  }
  if (q.workMode) pagePredicates.push(eq(jobs.workMode, q.workMode));

  // Contadores das abas: respeitam todos os filtros, menos o de modo de trabalho e o cursor.
  const countPredicates = filterPredicates(q, now);

  const { items, counts } = await runWithTimeout(db, (d) => ({
    items: d
      .select(summaryColumns)
      .from(jobs)
      .where(and(...pagePredicates))
      .orderBy(desc(jobs.publishedAt), desc(jobs.id))
      .limit(q.limit + 1),
    counts: withCounts
      ? d
          .select({
            all: sql<number>`count(*)::int`,
            remote: sql<number>`(count(*) filter (where ${jobs.workMode} = 'remote'))::int`,
            hybrid: sql<number>`(count(*) filter (where ${jobs.workMode} = 'hybrid'))::int`,
            onsite: sql<number>`(count(*) filter (where ${jobs.workMode} = 'onsite'))::int`,
          })
          .from(jobs)
          .where(and(...countPredicates))
      : undefined,
  }));

  const page = items.slice(0, q.limit);
  const last = page.at(-1);
  const result: ListJobsResult = {
    items: page.map(toSummary),
    nextCursor:
      items.length > q.limit && last ? encodeCursor({ publishedAt: last.publishedAt, id: last.id }) : null,
  };
  const c = counts?.[0];
  if (c) result.counts = { all: c.all, remote: c.remote, hybrid: c.hybrid, onsite: c.onsite };
  return result;
}

export async function getJob(db: Db, id: number, attributionFor?: AttributionFor): Promise<JobDetail | null> {
  const [row] = await db
    .select({ ...summaryColumns, urlCanonical: jobs.urlCanonical, descriptionHtml: jobs.descriptionHtml })
    .from(jobs)
    .where(and(eq(jobs.id, id), isNull(jobs.expiredAt)))
    .limit(1);
  if (!row) return null;

  const srcRows = await db
    .select({ source: jobSources.source, url: jobSources.url })
    .from(jobSources)
    .where(eq(jobSources.jobId, id))
    .orderBy(jobSources.source, jobSources.externalId);

  const attribution: JobAttribution[] = srcRows.map((s) => {
    const meta = attributionFor?.(s.source) ?? null;
    return { source: s.source, label: meta?.label ?? s.source, url: s.url, dofollow: meta?.dofollow ?? false };
  });

  const { urlCanonical, descriptionHtml, ...summary } = row;
  return { ...toSummary(summary), urlCanonical, descriptionHtml, attribution };
}
