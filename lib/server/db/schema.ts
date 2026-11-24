// Sem `import "server-only"`: o drizzle-kit carrega este arquivo fora do Next e
// não resolve esse pacote. O schema não contém segredos nem lógica de servidor.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Seniority, SourceId, WorkMode } from "@/lib/shared/types/job";

/*
 * Espelho do DDL da seção 5.2 da spec. A fonte de verdade é a migração
 * `drizzle/0000_init.sql` (editada à mão). O que o Drizzle não expressa fica
 * só no SQL:
 *   - extensão `unaccent` e as funções `f_unaccent` e `job_search_vector`;
 *   - `WITH (fillfactor = 85)` em job_sources (parâmetro de armazenamento);
 *   - `search_vector` é preenchido no upsert por `job_search_vector(...)`,
 *     não é coluna gerada.
 * Mantenha este arquivo alinhado com o SQL: `pnpm db:generate` não pode
 * produzir diff.
 */

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const jobs = pgTable(
  "jobs",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    dedupeKey: text("dedupe_key").notNull(),
    urlCanonical: text("url_canonical").notNull(),
    title: text().notNull(),
    company: text().notNull(),
    companyLogoUrl: text("company_logo_url"),
    summary: text().notNull().default(""),
    descriptionHtml: text("description_html").notNull(),
    sanitizerVersion: smallint("sanitizer_version").notNull(),
    country: char({ length: 2 }),
    city: text(),
    origin: text().notNull().default("unknown").$type<"national" | "international" | "unknown">(),
    acceptsBrazil: boolean("accepts_brazil"),
    workMode: text("work_mode").notNull().default("unknown").$type<WorkMode>(),
    seniority: text().$type<Seniority>(),
    language: text().notNull().default("unknown"),
    stacks: text().array().notNull().default(sql`'{}'`),
    sources: text().array().notNull().default(sql`'{}'`).$type<SourceId[]>(),
    salaryMin: numeric("salary_min", { precision: 12, scale: 2 }),
    salaryMax: numeric("salary_max", { precision: 12, scale: 2 }),
    salaryCurrency: char("salary_currency", { length: 3 }),
    salaryPeriod: text("salary_period").$type<"hour" | "month" | "year">(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    contentHash: text("content_hash").notNull(),
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    searchVector: tsvector("search_vector").notNull(),
  },
  (t) => [
    check("jobs_description_html_check", sql`octet_length(${t.descriptionHtml}) <= 30000`),
    check("jobs_origin_check", sql`${t.origin} IN ('national','international','unknown')`),
    check("jobs_work_mode_check", sql`${t.workMode} IN ('remote','hybrid','onsite','unknown')`),
    check("jobs_seniority_check", sql`${t.seniority} IN ('intern','junior','mid','senior','lead')`),
    check("jobs_salary_period_check", sql`${t.salaryPeriod} IN ('hour','month','year')`),
    uniqueIndex("jobs_dedupe_active_uq").on(t.dedupeKey).where(sql`${t.expiredAt} IS NULL`),
    uniqueIndex("jobs_url_active_uq").on(t.urlCanonical).where(sql`${t.expiredAt} IS NULL`),
    index("jobs_feed_idx")
      .on(t.publishedAt.desc(), t.id.desc())
      .where(sql`${t.expiredAt} IS NULL`),
    index("jobs_mode_feed_idx")
      .on(t.workMode, t.publishedAt.desc(), t.id.desc())
      .where(sql`${t.expiredAt} IS NULL`),
    index("jobs_stacks_gin").using("gin", t.stacks).where(sql`${t.expiredAt} IS NULL`),
    index("jobs_sources_gin").using("gin", t.sources).where(sql`${t.expiredAt} IS NULL`),
    index("jobs_fts_gin").using("gin", t.searchVector).where(sql`${t.expiredAt} IS NULL`),
    index("jobs_expired_idx").on(t.expiredAt).where(sql`${t.expiredAt} IS NOT NULL`),
  ],
);

export const jobSources = pgTable(
  "job_sources",
  {
    source: text().notNull().$type<SourceId>(),
    externalId: text("external_id").notNull(),
    jobId: bigint("job_id", { mode: "number" })
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    url: text().notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    missedRuns: smallint("missed_runs").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.source, t.externalId] }),
    index("job_sources_job_idx").on(t.jobId),
  ],
);

export const sourceState = pgTable("source_state", {
  source: text().primaryKey().$type<SourceId>(),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFetchedCount: integer("last_fetched_count"),
  cursor: text(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

export const sourceRuns = pgTable(
  "source_runs",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    source: text().notNull().$type<SourceId>(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text().notNull().$type<"running" | "ok" | "error" | "skipped">(),
    fetchedCount: integer("fetched_count"),
    newCount: integer("new_count"),
    updatedCount: integer("updated_count"),
    expiredCount: integer("expired_count"),
    error: text(),
  },
  (t) => [
    check("source_runs_status_check", sql`${t.status} IN ('running','ok','error','skipped')`),
    index("source_runs_src_idx").on(t.source, t.startedAt.desc()),
  ],
);
