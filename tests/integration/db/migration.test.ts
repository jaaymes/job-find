import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db, getHttpDb, getPoolDb } from "@/lib/server/db/client";
import { insertJobRaw, resetDb, testDb } from "../setup";

// Verificação de tipos: os três drivers precisam ser aceitos como `Db`.
export const aceitaDb = (db: Db) => db;
export type DriversAceitos = [
  Parameters<typeof aceitaDb>[0],
  ReturnType<typeof getHttpDb> extends Db ? true : never,
  ReturnType<typeof getPoolDb> extends Db ? true : never,
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
