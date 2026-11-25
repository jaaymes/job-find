import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { dedupeKey } from "@/lib/server/enrich/dedupe";
import { applyRekey, loadRekeyRows, planRekey } from "@/lib/server/jobs/rekey";
import { upsertJob } from "@/lib/server/jobs/upsert";
import { UNKNOWN_COMPANY } from "@/lib/server/sources/types";
import { resetDb, testDb } from "../setup";
import { addDays, getRow, makeJob, T0 } from "./helpers";

const berlin = { country: "DE", city: "Berlin", workMode: "onsite" as const };
const NOW = addDays(T0, 1);

async function rekeyAll(db: Awaited<ReturnType<typeof testDb>>) {
  return applyRekey(db, planRekey(await loadRekeyRows(db)), NOW);
}

describe("rekey", () => {
  beforeEach(resetDb);

  it("funde, regrava a chave e deixa a integridade em zero", async () => {
    const db = await testDb();
    const a = await upsertJob(
      db,
      makeJob({ ...berlin, company: "resonads GmbH", title: "Backend Developer (m/w/d)", dedupeKey: "dk-a", urlCanonical: "https://boards.greenhouse.io/resonads/jobs/1" }),
      { source: "greenhouse", externalId: "g-1", url: "https://boards.greenhouse.io/resonads/jobs/1" },
      T0,
    );
    const b = await upsertJob(
      db,
      makeJob({ ...berlin, company: "resonads", title: "Backend Developer", dedupeKey: "dk-b", urlCanonical: "https://www.arbeitnow.com/jobs/resonads-1" }),
      { source: "arbeitnow", externalId: "a-1", url: "https://www.arbeitnow.com/jobs/resonads-1" },
      T0,
    );

    const result = await rekeyAll(db);

    expect(result).toEqual({ merged: 1, rekeyed: 1 });
    const survivor = await getRow(db, a.jobId);
    expect(survivor.expiredAt).toBeNull();
    expect(survivor.dedupeKey).toBe(dedupeKey({ ...berlin, company: "resonads", title: "Backend Developer" }));
    expect(survivor.urlCanonical).toBe("https://boards.greenhouse.io/resonads/jobs/1");
    expect(survivor.sources).toEqual(["arbeitnow", "greenhouse"]);
    expect((await getRow(db, b.jobId)).expiredAt).toEqual(NOW);

    // Consulta 5.4 de scripts/db-audit.sql.
    const { rows } = await db.execute<{ chave_dup: number; url_dup: number; ativa_sem_fonte: number }>(sql`
      SELECT
        (SELECT count(*) FROM (SELECT dedupe_key FROM jobs WHERE expired_at IS NULL GROUP BY 1 HAVING count(*) > 1) d)::int AS chave_dup,
        (SELECT count(*) FROM (SELECT url_canonical FROM jobs WHERE expired_at IS NULL GROUP BY 1 HAVING count(*) > 1) u)::int AS url_dup,
        (SELECT count(*) FROM jobs j WHERE expired_at IS NULL AND NOT EXISTS (SELECT 1 FROM job_sources s WHERE s.job_id = j.id))::int AS ativa_sem_fonte`);
    expect(rows[0]).toEqual({ chave_dup: 0, url_dup: 0, ativa_sem_fonte: 0 });
  });

  it("troca de chaves entre duas vagas não viola o índice único", async () => {
    const db = await testDb();
    const fieldsA = { ...berlin, company: "Acme", title: "Backend Developer" };
    const fieldsB = { ...berlin, company: "Acme", title: "Frontend Developer" };
    const urlA = "https://example.com/jobs/a";
    const urlB = "https://example.com/jobs/b";
    // Cada uma está gravada com a chave nova da outra.
    const a = await upsertJob(db, makeJob({ ...fieldsA, dedupeKey: dedupeKey(fieldsB), urlCanonical: urlA }), { source: "greenhouse", externalId: "g-1", url: urlA }, T0);
    const b = await upsertJob(db, makeJob({ ...fieldsB, dedupeKey: dedupeKey(fieldsA), urlCanonical: urlB }), { source: "greenhouse", externalId: "g-2", url: urlB }, T0);

    expect(await rekeyAll(db)).toEqual({ merged: 0, rekeyed: 2 });
    expect((await getRow(db, a.jobId)).dedupeKey).toBe(dedupeKey(fieldsA));
    expect((await getRow(db, b.jobId)).dedupeKey).toBe(dedupeKey(fieldsB));
  });

  it("rodar duas vezes não muda nada na segunda", async () => {
    const db = await testDb();
    await upsertJob(
      db,
      makeJob({ ...berlin, company: "Acme GmbH", title: "Backend Developer (m/w/d)", dedupeKey: "dk-a", urlCanonical: "https://job-boards.greenhouse.io/acme/jobs/1" }),
      { source: "greenhouse", externalId: "g-1", url: "https://job-boards.greenhouse.io/acme/jobs/1" },
      T0,
    );
    await upsertJob(
      db,
      makeJob({ ...berlin, company: "Acme", title: "Backend Developer", dedupeKey: "dk-b", urlCanonical: "https://example.com/acme/1" }),
      { source: "arbeitnow", externalId: "a-1", url: "https://example.com/acme/1" },
      T0,
    );
    await rekeyAll(db);
    expect(planRekey(await loadRekeyRows(db))).toEqual([]);
    expect(await rekeyAll(db)).toEqual({ merged: 0, rekeyed: 0 });
  });

  it("deixa de fora as vagas expiradas e as de empresa vazia ou desconhecida", async () => {
    const db = await testDb();
    const kept = await upsertJob(db, makeJob({ company: "Acme", dedupeKey: "dk-1", urlCanonical: "https://example.com/1" }), { source: "greenhouse", externalId: "g-1", url: "https://example.com/1" }, T0);
    await upsertJob(db, makeJob({ company: UNKNOWN_COMPANY, dedupeKey: "dk-2", urlCanonical: "https://example.com/2" }), { source: "greenhouse", externalId: "g-2", url: "https://example.com/2" }, T0);
    await upsertJob(db, makeJob({ company: "", dedupeKey: "dk-3", urlCanonical: "https://example.com/3" }), { source: "greenhouse", externalId: "g-3", url: "https://example.com/3" }, T0);
    const expired = await upsertJob(db, makeJob({ company: "Acme", dedupeKey: "dk-4", urlCanonical: "https://example.com/4" }), { source: "greenhouse", externalId: "g-4", url: "https://example.com/4" }, T0);
    await db.execute(sql`UPDATE jobs SET expired_at = now() WHERE id = ${expired.jobId}`);

    expect((await loadRekeyRows(db)).map((r) => r.id)).toEqual([kept.jobId]);
  });
});
