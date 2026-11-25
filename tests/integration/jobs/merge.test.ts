import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { mergeJobs } from "@/lib/server/jobs/merge";
import { upsertJob } from "@/lib/server/jobs/upsert";
import { resetDb, testDb } from "../setup";
import { addDays, getRow, getSource, makeJob, T0 } from "./helpers";

const urlA = "https://boards.example.com/acme/1";
const urlB = "https://himalayas.app/acme/1";

describe("mergeJobs", () => {
  beforeEach(resetDb);

  it("funde na mais confiável, move as fontes e expira a perdedora", async () => {
    const db = await testDb();
    const a = await upsertJob(
      db,
      makeJob({ dedupeKey: "dk-a", urlCanonical: urlA, publishedAt: addDays(T0, -5) }),
      { source: "greenhouse", externalId: "g-1", url: urlA },
      T0,
    );
    const b = await upsertJob(
      db,
      makeJob({ dedupeKey: "dk-b", urlCanonical: urlB, publishedAt: addDays(T0, -9) }),
      { source: "himalayas", externalId: "h-1", url: urlB },
      T0,
    );
    const now = addDays(T0, 1);
    const survivor = await mergeJobs(db, [b.jobId!, a.jobId!], now);
    expect(survivor).toBe(a.jobId);
    expect((await getRow(db, b.jobId)).expiredAt).toEqual(now);
    expect((await getRow(db, a.jobId)).expiredAt).toBeNull();
    expect((await getSource(db, "himalayas", "h-1"))?.jobId).toBe(a.jobId);
    const row = await getRow(db, a.jobId);
    expect(row.sources).toEqual(["greenhouse", "himalayas"]);
    expect(row.publishedAt).toEqual(addDays(T0, -9));
    expect(row.updatedAt).toEqual(now);
  });

  it("empate de confiança: fica a vista primeiro", async () => {
    const db = await testDb();
    const first = await upsertJob(
      db,
      makeJob({ dedupeKey: "dk-a", urlCanonical: urlA }),
      { source: "himalayas", externalId: "h-1", url: urlA },
      T0,
    );
    const second = await upsertJob(
      db,
      makeJob({ dedupeKey: "dk-b", urlCanonical: urlB }),
      { source: "himalayas", externalId: "h-2", url: urlB },
      addDays(T0, 1),
    );
    expect(await mergeJobs(db, [second.jobId!, first.jobId!], addDays(T0, 2))).toBe(first.jobId);
    expect((await getRow(db, second.jobId)).expiredAt).not.toBeNull();
  });

  it("fonte repetida não duplica sources", async () => {
    const db = await testDb();
    const a = await upsertJob(
      db,
      makeJob({ dedupeKey: "dk-a", urlCanonical: urlA }),
      { source: "greenhouse", externalId: "g-1", url: urlA },
      T0,
    );
    const b = await upsertJob(
      db,
      makeJob({ dedupeKey: "dk-b", urlCanonical: urlB }),
      { source: "greenhouse", externalId: "g-2", url: urlB },
      T0,
    );
    await mergeJobs(db, [a.jobId!, b.jobId!], addDays(T0, 1));
    expect((await getRow(db, a.jobId)).sources).toEqual(["greenhouse"]);
    expect((await getSource(db, "greenhouse", "g-2"))?.jobId).toBe(a.jobId);
  });

  it("um id só não grava nada", async () => {
    const db = await testDb();
    const a = await upsertJob(
      db,
      makeJob({ dedupeKey: "dk-a", urlCanonical: urlA }),
      { source: "greenhouse", externalId: "g-1", url: urlA },
      T0,
    );
    expect(await mergeJobs(db, [a.jobId!, a.jobId!], addDays(T0, 1))).toBe(a.jobId);
    const row = await getRow(db, a.jobId);
    expect(row.updatedAt).toEqual(T0);
    expect(row.expiredAt).toBeNull();
  });

  it("id inexistente lança erro", async () => {
    const db = await testDb();
    const a = await upsertJob(
      db,
      makeJob({ dedupeKey: "dk-a", urlCanonical: urlA }),
      { source: "greenhouse", externalId: "g-1", url: urlA },
      T0,
    );
    await expect(mergeJobs(db, [a.jobId!, 999_999], addDays(T0, 1))).rejects.toThrow("mergeJobs");
    expect((await getRow(db, a.jobId)).expiredAt).toBeNull();
  });

  it("vaga já expirada lança erro e não grava nada", async () => {
    const db = await testDb();
    const a = await upsertJob(
      db,
      makeJob({ dedupeKey: "dk-a", urlCanonical: urlA }),
      { source: "himalayas", externalId: "h-1", url: urlA },
      T0,
    );
    const b = await upsertJob(
      db,
      makeJob({ dedupeKey: "dk-b", urlCanonical: urlB }),
      { source: "greenhouse", externalId: "g-1", url: urlB },
      T0,
    );
    const expiredAt = addDays(T0, 2);
    await db.execute(sql`UPDATE jobs SET expired_at = ${expiredAt.toISOString()}::timestamptz WHERE id = ${b.jobId}`);
    await expect(mergeJobs(db, [a.jobId!, b.jobId!], addDays(T0, 3))).rejects.toThrow("mergeJobs");
    expect((await getRow(db, a.jobId)).expiredAt).toBeNull();
    expect((await getRow(db, b.jobId)).expiredAt).toEqual(expiredAt);
    expect((await getSource(db, "greenhouse", "g-1"))?.jobId).toBe(b.jobId);
  });
});
