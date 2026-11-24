import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll } from "vitest";
import * as schema from "@/lib/server/db/schema";

// Constante de teste (Postgres de docker-compose.test.yml), não é variável de ambiente.
export const TEST_DATABASE_URL =
  "postgres://postgres:postgres@127.0.0.1:54329/jobfind_test";

type TestDb = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let db: TestDb | undefined;
let ready: Promise<TestDb> | undefined;

/** Um pool por worker; as migrações rodam uma vez. */
export function testDb(): Promise<TestDb> {
  ready ??= (async () => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: resolve(import.meta.dirname, "../../drizzle") });
    return db;
  })();
  return ready;
}

export async function resetDb(): Promise<void> {
  const d = await testDb();
  await d.execute(
    sql`TRUNCATE jobs, job_sources, source_state, source_runs RESTART IDENTITY CASCADE`,
  );
}

afterAll(async () => {
  await pool?.end();
  pool = undefined;
  db = undefined;
  ready = undefined;
});

export type RawJob = {
  dedupe_key: string;
  url_canonical: string;
  title: string;
  company: string;
  description_html: string;
  sanitizer_version: number;
  published_at: Date;
  content_hash: string;
  expired_at: Date | null;
  stacks: string[];
  sources: string[];
};

let seq = 0;

// O drizzle expande arrays JS em lista de parâmetros; aqui passamos o literal do Postgres.
function pgArray(values: string[]): string {
  return `{${values.map((v) => `"${v.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
}

/** Só para testes: preenche todas as colunas NOT NULL e aceita sobrescritas. */
export async function insertJobRaw(
  d: TestDb,
  partial: Partial<RawJob> = {},
): Promise<{ id: number }> {
  seq += 1;
  const j: RawJob = {
    dedupe_key: `dedupe-${seq}`,
    url_canonical: `https://example.com/job/${seq}`,
    title: "Desenvolvedor",
    company: "Acme",
    description_html: "<p>Descrição</p>",
    sanitizer_version: 1,
    published_at: new Date(),
    content_hash: `hash-${seq}`,
    expired_at: null,
    stacks: [],
    sources: [],
    ...partial,
  };
  const r = await d
    .execute<{ id: number }>(sql`
    INSERT INTO jobs (dedupe_key, url_canonical, title, company, description_html,
      sanitizer_version, published_at, content_hash, expired_at, stacks, sources, search_vector)
    VALUES (${j.dedupe_key}, ${j.url_canonical}, ${j.title}, ${j.company}, ${j.description_html},
      ${j.sanitizer_version}, ${j.published_at}, ${j.content_hash}, ${j.expired_at},
      ${pgArray(j.stacks)}::text[], ${pgArray(j.sources)}::text[],
      job_search_vector(${j.title}, ${j.company}, ${pgArray(j.stacks)}::text[], 'unknown', ${j.description_html}))
    RETURNING id`)
    // O drizzle embrulha o erro do pg; devolvemos o original (mensagem com o nome da constraint).
    .catch((e: unknown) => {
      throw e instanceof Error && e.cause instanceof Error ? e.cause : e;
    });
  return r.rows[0];
}
