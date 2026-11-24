import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "@/lib/server/db/schema";
import type { EnrichedJob } from "@/lib/server/jobs/enrich-job";
import { upsertJob } from "@/lib/server/jobs/upsert";
import type { SourceId } from "@/lib/shared/types/job";

// Constante de teste (Postgres de docker-compose.test.yml), não é variável de ambiente.
const TEST_DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:54329/jobfind_test";

export type E2eDb = NodePgDatabase<typeof schema>;

export const JOB_COUNT = 40;
export const MINUTE = 60_000;

const SOURCES: SourceId[] = ["greenhouse", "himalayas", "lever", "ashby"];
const MODES = ["remote", "remote", "hybrid", "onsite"] as const;

/** Vaga `i` (0 = mais nova): título numerado, publicada `(i + 1) * 30` min antes de `now`. */
export function seedJob(i: number, now: Date): EnrichedJob {
  const nn = String(i).padStart(2, "0");
  const national = i % 3 === 0;
  const stacks = i % 2 === 0 ? ["react", "typescript"] : ["vue"];
  return {
    dedupeKey: `e2e-${nn}`,
    urlCanonical: `https://boards.example.com/e2e/${nn}`,
    title: `Vaga ${nn} Desenvolvedor`,
    company: `Empresa ${nn}`,
    companyLogoUrl: null,
    summary: `Resumo da vaga ${nn}`,
    descriptionHtml: `<p>Descrição ${nn}</p>`,
    sanitizerVersion: 1,
    searchBody: `Descrição ${nn}`,
    country: national ? "BR" : "US",
    city: national ? "São Paulo" : null,
    origin: national ? "national" : "international",
    acceptsBrazil: true,
    workMode: MODES[i % 4],
    seniority: i % 2 === 0 ? "senior" : "mid",
    language: national ? "pt" : "en",
    stacks,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    publishedAt: new Date(now.getTime() - (i + 1) * 30 * MINUTE),
    contentHash: `e2e-hash-${nn}`,
  };
}

/** Migra o banco de teste, limpa as tabelas e grava as 40 vagas via `upsertJob`. */
export async function seedDatabase(): Promise<{ db: E2eDb; close: () => Promise<void> }> {
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
  await db.execute(sql`TRUNCATE jobs, job_sources, source_state, source_runs RESTART IDENTITY CASCADE`);
  const now = new Date();
  for (let i = 0; i < JOB_COUNT; i++) {
    const job = seedJob(i, now);
    const source = SOURCES[i % SOURCES.length];
    await upsertJob(db, job, { source, externalId: `e2e-${i}`, url: job.urlCanonical }, now);
  }
  return { db, close: () => pool.end() };
}
