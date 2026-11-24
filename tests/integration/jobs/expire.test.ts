import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { jobs, jobSources } from "@/lib/server/db/schema";
import { expireJobs, markMissedRuns, purgeExpired } from "@/lib/server/jobs/expire";
import { insertJobRaw, resetDb, testDb } from "../setup";
import { addDays, T0 } from "./helpers";

async function addSource(
  db: Awaited<ReturnType<typeof testDb>>,
  jobId: number,
  source: "greenhouse" | "himalayas",
  externalId: string,
  lastSeenAt: Date,
  missedRuns = 0,
) {
  await db.insert(jobSources).values({ source, externalId, jobId, url: "https://x.example.com", lastSeenAt, missedRuns });
}

describe("markMissedRuns", () => {
  beforeEach(resetDb);

  it("fonte vazia ou parcial não conta falhas", async () => {
    const db = await testDb();
    const { id } = await insertJobRaw(db, { published_at: addDays(T0, -1), sources: ["greenhouse"] });
    await addSource(db, id, "greenhouse", "e1", addDays(T0, -1));
    expect(await markMissedRuns(db, "greenhouse", T0, 0, 400)).toBe(0);
    expect(await markMissedRuns(db, "greenhouse", T0, 150, 400)).toBe(0);
    const [s] = await db.select().from(jobSources);
    expect(s.missedRuns).toBe(0);
  });

  it("coleta completa incrementa só quem não foi visto nesta coleta", async () => {
    const db = await testDb();
    const a = await insertJobRaw(db, { sources: ["greenhouse"] });
    const b = await insertJobRaw(db, { sources: ["greenhouse"] });
    const c = await insertJobRaw(db, { sources: ["himalayas"] });
    await addSource(db, a.id, "greenhouse", "a", addDays(T0, -1));
    await addSource(db, b.id, "greenhouse", "b", T0); // visto agora
    await addSource(db, c.id, "himalayas", "c", addDays(T0, -1)); // outra fonte
    expect(await markMissedRuns(db, "greenhouse", T0, 390, 400)).toBe(1);
    const rows = await db.select().from(jobSources);
    const by = Object.fromEntries(rows.map((r) => [r.externalId, r.missedRuns]));
    expect(by).toEqual({ a: 1, b: 0, c: 0 });
  });

  it("sem coleta anterior (previousCount nulo) conta falhas se veio algo", async () => {
    const db = await testDb();
    const a = await insertJobRaw(db, { sources: ["greenhouse"] });
    await addSource(db, a.id, "greenhouse", "a", addDays(T0, -1));
    expect(await markMissedRuns(db, "greenhouse", T0, 10, null)).toBe(1);
  });
});

describe("expireJobs", () => {
  beforeEach(resetDb);

  it("expira com mais de 45 dias e mantém as recentes", async () => {
    const db = await testDb();
    const old = await insertJobRaw(db, { published_at: addDays(T0, -46) });
    const edge = await insertJobRaw(db, { published_at: addDays(T0, -45) });
    const fresh = await insertJobRaw(db, { published_at: addDays(T0, -10) });
    expect(await expireJobs(db, T0)).toBe(1);
    const rows = await db.select().from(jobs);
    const exp = Object.fromEntries(rows.map((r) => [r.id, r.expiredAt]));
    expect(exp[old.id]).toEqual(T0);
    expect(exp[edge.id]).toBeNull();
    expect(exp[fresh.id]).toBeNull();
  });

  it("expira com 3 coletas sem ver em nenhuma fonte; vista em outra fonte continua", async () => {
    const db = await testDb();
    const gone = await insertJobRaw(db, { sources: ["greenhouse", "himalayas"] });
    await addSource(db, gone.id, "greenhouse", "g1", addDays(T0, -3), 3);
    await addSource(db, gone.id, "himalayas", "h1", addDays(T0, -3), 4);
    const kept = await insertJobRaw(db, { sources: ["greenhouse", "himalayas"] });
    await addSource(db, kept.id, "greenhouse", "g2", addDays(T0, -3), 3);
    await addSource(db, kept.id, "himalayas", "h2", T0, 0);
    const two = await insertJobRaw(db, { sources: ["greenhouse"] });
    await addSource(db, two.id, "greenhouse", "g3", addDays(T0, -2), 2);
    expect(await expireJobs(db, T0)).toBe(1);
    const rows = await db.select().from(jobs);
    const exp = Object.fromEntries(rows.map((r) => [r.id, r.expiredAt]));
    expect(exp[gone.id]).toEqual(T0);
    expect(exp[kept.id]).toBeNull();
    expect(exp[two.id]).toBeNull();
  });

  it("não reexpira vagas já expiradas", async () => {
    const db = await testDb();
    const before = addDays(T0, -5);
    await insertJobRaw(db, { published_at: addDays(T0, -60), expired_at: before });
    expect(await expireJobs(db, T0)).toBe(0);
    const [r] = await db.select().from(jobs);
    expect(r.expiredAt).toEqual(before);
  });
});

describe("purgeExpired", () => {
  beforeEach(resetDb);

  it("apaga expiradas há mais de 30 dias (e suas job_sources)", async () => {
    const db = await testDb();
    const old = await insertJobRaw(db, { expired_at: addDays(T0, -31) });
    const recent = await insertJobRaw(db, { expired_at: addDays(T0, -29) });
    const active = await insertJobRaw(db, { expired_at: null });
    await addSource(db, old.id, "greenhouse", "x", T0);
    expect(await purgeExpired(db, T0)).toBe(1);
    const ids = (await db.select({ id: jobs.id }).from(jobs)).map((r) => r.id).sort((a, b) => a - b);
    expect(ids).toEqual([Number(recent.id), Number(active.id)].sort((a, b) => a - b));
    expect(await db.select().from(jobSources).where(eq(jobSources.externalId, "x"))).toHaveLength(0);
  });
});
