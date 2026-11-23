import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db, getHttpDb, getPoolDb } from "@/lib/server/db/client";
import { insertJobRaw, resetDb, testDb } from "../setup";

// Verificação de tipos: os três drivers precisam ser atribuíveis a `Db`.
// Se algum deixar de ser, `pnpm typecheck` falha aqui.
const aceitaDb = (db: Db) => db;
type TestDb = Awaited<ReturnType<typeof testDb>>;
export const driversAceitos: Array<(h: ReturnType<typeof getHttpDb>, p: ReturnType<typeof getPoolDb>, n: TestDb) => Db[]> = [
  (h, p, n) => [aceitaDb(h), aceitaDb(p), aceitaDb(n)],
];

describe("migração inicial do banco", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("busca com unaccent e stemming em português", async () => {
    const db = await testDb();
    aceitaDb(db);
    const r = await db.execute<{ ok: boolean }>(
      sql`select job_search_vector('Dev React','Lumen',array['react'],'pt','Vaga de programação') @@ websearch_to_tsquery('portuguese','programacao') as ok`,
    );
    expect(r.rows[0].ok).toBe(true);
  });

  it("deduplica só vagas ativas (índice único parcial)", async () => {
    const db = await testDb();
    await expect(
      insertJobRaw(db, { dedupe_key: "k", expired_at: null }),
    ).resolves.toBeDefined();
    await expect(
      insertJobRaw(db, { dedupe_key: "k", expired_at: null }),
    ).rejects.toThrow(/jobs_dedupe_active_uq/);
    await expect(
      insertJobRaw(db, { dedupe_key: "k", expired_at: new Date() }),
    ).resolves.toBeDefined();
  });
});
