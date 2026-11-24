import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { enrichJob } from "@/lib/server/jobs/enrich-job";
import type { NormalizedJob } from "@/lib/server/sources/types";
import { upsertJob } from "@/lib/server/jobs/upsert";
import { jobSources, jobs } from "@/lib/server/db/schema";
import { resetDb, testDb } from "../setup";
import { addDays, getRow, getSource, makeJob, T0 } from "./helpers";

const ref = { source: "greenhouse", externalId: "g-1", url: "https://boards.example.com/acme/1" } as const;
const ref2 = { source: "himalayas", externalId: "h-1", url: "https://himalayas.app/acme/1" } as const;

describe("upsertJob", () => {
  beforeEach(resetDb);

  it("insere, depois não altera quando nada mudou, e registra job_sources", async () => {
    const db = await testDb();
    const job = makeJob();
    const a = await upsertJob(db, job, ref, T0);
    expect(a.status).toBe("inserted");
    const t1 = addDays(T0, 1);
    const b = await upsertJob(db, job, ref, t1);
    expect(b.status).toBe("unchanged");
    expect(b.jobId).toBe(a.jobId);
    const row = await getRow(db, a.jobId);
    expect(row.sources).toEqual(["greenhouse"]);
    expect(row.firstSeenAt).toEqual(T0);
    expect(row.updatedAt).toEqual(T0);
    const src = await getSource(db, "greenhouse", "g-1");
    expect(src?.lastSeenAt).toEqual(t1);
    expect(src?.missedRuns).toBe(0);
  });

  it("zera missed_runs ao rever a vaga", async () => {
    const db = await testDb();
    const job = makeJob();
    await upsertJob(db, job, ref, T0);
    await db.execute(sql`UPDATE job_sources SET missed_runs = 2`);
    await upsertJob(db, job, ref, addDays(T0, 1));
    expect((await getSource(db, "greenhouse", "g-1"))?.missedRuns).toBe(0);
  });

  it("junta a mesma vaga vinda de outra fonte (mesmo dedupe_key)", async () => {
    const db = await testDb();
    const job = makeJob();
    const a = await upsertJob(db, job, ref, T0);
    const t1 = addDays(T0, 1);
    const c = await upsertJob(
      db,
      { ...job, title: `${job.title} `, urlCanonical: "https://himalayas.app/acme/1", contentHash: "h2" },
      ref2,
      t1,
    );
    expect(c.status).toBe("updated");
    expect(c.jobId).toBe(a.jobId);
    const row = await getRow(db, a.jobId);
    expect(row.sources).toEqual(["greenhouse", "himalayas"]);
    expect(row.updatedAt).toEqual(t1);
  });

  it("fonte menos confiável com o mesmo dedupe_key não reescreve o conteúdo de um ATS", async () => {
    const db = await testDb();
    const job = makeJob();
    const a = await upsertJob(db, job, ref, T0);
    const t1 = addDays(T0, 1);
    const evil = {
      ...job,
      descriptionHtml: "<p>Candidate-se em evil.example.com</p>",
      urlCanonical: "https://news.ycombinator.com/item?id=1",
      contentHash: "h-evil",
    };
    const hnRef = { source: "hn", externalId: "hn-1", url: "https://news.ycombinator.com/item?id=1" } as const;
    const b = await upsertJob(db, evil, hnRef, t1);
    expect(b).toEqual({ jobId: a.jobId, status: "updated" });
    let row = await getRow(db, a.jobId);
    expect(row.sources).toEqual(["greenhouse", "hn"]);
    expect(row.descriptionHtml).toBe(job.descriptionHtml);
    expect(row.contentHash).toBe(job.contentHash);

    // Revista, a fonte menos confiável não reescreve nada (nem updated_at).
    const c = await upsertJob(db, evil, hnRef, addDays(T0, 2));
    expect(c.status).toBe("unchanged");
    row = await getRow(db, a.jobId);
    expect(row.updatedAt).toEqual(t1);
    expect(row.descriptionHtml).toBe(job.descriptionHtml);
  });

  it("mesma URL canônica vinda de fonte menos confiável também não reescreve o conteúdo", async () => {
    const db = await testDb();
    const job = makeJob();
    const a = await upsertJob(db, job, ref, T0);
    await upsertJob(
      db,
      { ...job, dedupeKey: "dk-evil", descriptionHtml: "<p>falsa</p>", contentHash: "h-evil" },
      { source: "github", externalId: "gh-1", url: ref.url },
      addDays(T0, 1),
    );
    const row = await getRow(db, a.jobId);
    expect(row.descriptionHtml).toBe(job.descriptionHtml);
    expect(row.dedupeKey).toBe(job.dedupeKey);
  });

  it("fonte mais confiável reescreve o conteúdo de uma vaga vinda do HN", async () => {
    const db = await testDb();
    const job = makeJob();
    const hnRef = { source: "hn", externalId: "hn-1", url: "https://news.ycombinator.com/item?id=1" } as const;
    const a = await upsertJob(db, { ...job, urlCanonical: hnRef.url, descriptionHtml: "<p>hn</p>", contentHash: "h-hn" }, hnRef, T0);
    const b = await upsertJob(db, job, ref, addDays(T0, 1));
    expect(b).toEqual({ jobId: a.jobId, status: "updated" });
    expect((await getRow(db, a.jobId)).descriptionHtml).toBe(job.descriptionHtml);
  });

  it("atualiza a vaga quando o conteúdo da mesma fonte muda", async () => {
    const db = await testDb();
    const a = await upsertJob(db, makeJob(), ref, T0);
    const b = await upsertJob(
      db,
      makeJob({ contentHash: "h-novo", descriptionHtml: "<p>Nova</p>", stacks: ["react", "node"] }),
      ref,
      addDays(T0, 1),
    );
    expect(b).toEqual({ jobId: a.jobId, status: "updated" });
    const row = await getRow(db, a.jobId);
    expect(row.descriptionHtml).toBe("<p>Nova</p>");
    expect(row.stacks).toEqual(["react", "node"]);
  });

  it("mesma URL canônica com dedupe_key diferente continua sendo a mesma vaga", async () => {
    const db = await testDb();
    const a = await upsertJob(db, makeJob(), ref, T0);
    const b = await upsertJob(
      db,
      makeJob({ dedupeKey: "dk-outro", contentHash: "h2" }),
      { ...ref2, url: "https://boards.example.com/acme/1" },
      addDays(T0, 1),
    );
    expect(b.jobId).toBe(a.jobId);
    expect((await getRow(db, a.jobId)).sources).toEqual(["greenhouse", "himalayas"]);
  });

  it("published_at nunca sobe, futuro vira now e ausente vira first_seen", async () => {
    const db = await testDb();
    const job = makeJob();
    const a = await upsertJob(db, job, ref, T0);
    await upsertJob(
      db,
      { ...job, publishedAt: addDays(job.publishedAt as Date, 3), contentHash: "h2" },
      ref,
      addDays(T0, 1),
    );
    expect((await getRow(db, a.jobId)).publishedAt).toEqual(job.publishedAt);
    await upsertJob(
      db,
      { ...job, publishedAt: addDays(T0, -9), contentHash: "h3" },
      ref,
      addDays(T0, 2),
    );
    expect((await getRow(db, a.jobId)).publishedAt).toEqual(addDays(T0, -9));

    const f = await upsertJob(
      db,
      makeJob({ dedupeKey: "dk-2", urlCanonical: "https://x.example.com/2", publishedAt: addDays(T0, 10) }),
      { source: "ashby", externalId: "a-2", url: "https://x.example.com/2" },
      T0,
    );
    expect((await getRow(db, f.jobId)).publishedAt).toEqual(T0);
    const g = await upsertJob(
      db,
      makeJob({ dedupeKey: "dk-3", urlCanonical: "https://x.example.com/3", publishedAt: null }),
      { source: "ashby", externalId: "a-3", url: "https://x.example.com/3" },
      T0,
    );
    expect((await getRow(db, g.jobId)).publishedAt).toEqual(T0);
  });

  it("janela de 30 dias: vaga igual depois de 31 dias expira a antiga e insere nova", async () => {
    const db = await testDb();
    const job = makeJob();
    const a = await upsertJob(db, job, ref, T0);
    const t31 = addDays(T0, 31);
    const d = await upsertJob(
      db,
      { ...job, urlCanonical: "https://boards.example.com/acme/novo" },
      { source: "greenhouse", externalId: "g-novo", url: "https://boards.example.com/acme/novo" },
      t31,
    );
    expect(d.status).toBe("inserted");
    expect(d.jobId).not.toBe(a.jobId);
    expect((await getRow(db, a.jobId)).expiredAt).toEqual(t31);
    expect((await getRow(db, d.jobId)).expiredAt).toBeNull();
  });

  it("não expira pela janela quando é a mesma publicação da mesma fonte", async () => {
    const db = await testDb();
    const a = await upsertJob(db, makeJob(), ref, T0);
    const b = await upsertJob(db, makeJob(), ref, addDays(T0, 40));
    expect(b.jobId).toBe(a.jobId);
    expect((await getRow(db, a.jobId)).expiredAt).toBeNull();
  });

  it("converte salário para as colunas numéricas", async () => {
    const db = await testDb();
    const a = await upsertJob(
      db,
      makeJob({ salaryMin: 5000, salaryMax: 8000.5, salaryCurrency: "BRL", salaryPeriod: "month" }),
      ref,
      T0,
    );
    const row = await getRow(db, a.jobId);
    expect(row.salaryMin).toBe("5000.00");
    expect(row.salaryMax).toBe("8000.50");
    expect(row.salaryCurrency).toBe("BRL");
  });

  it("fontes alternadas com o mesmo conteúdo não reescrevem a vaga (hash independe da fonte)", async () => {
    const db = await testDb();
    const norm = (url: string): NormalizedJob => ({
      externalId: "x",
      url,
      title: "Senior React Developer",
      company: "Acme",
      companyLogoUrl: null,
      descriptionHtml: "<p>Build things with React</p>",
      descriptionFormat: "html",
      country: "BR",
      city: "São Paulo",
      locationText: "São Paulo, Brazil",
      eligibleRegions: [],
      workModeHint: "remote",
      seniorityHint: null,
      tags: ["react"],
      salary: null,
      publishedAt: addDays(T0, -5),
    });
    const enrich = (id: "greenhouse" | "himalayas", url: string) => {
      const j = enrichJob(norm(url), { id, brazilian: false, dofollow: false });
      if (!j) throw new Error("esperava vaga");
      return j;
    };
    const g = enrich("greenhouse", "https://boards.example.com/acme/1");
    const h = enrich("himalayas", "https://himalayas.app/acme/1");
    expect(g.contentHash).toBe(h.contentHash);
    const gRef = { source: "greenhouse", externalId: "g", url: "https://boards.example.com/acme/1" } as const;
    const hRef = { source: "himalayas", externalId: "h", url: "https://himalayas.app/acme/1" } as const;
    expect((await upsertJob(db, g, gRef, T0)).status).toBe("inserted");
    expect((await upsertJob(db, h, hRef, addDays(T0, 1))).status).toBe("updated"); // só mescla as fontes
    expect((await upsertJob(db, g, gRef, addDays(T0, 2))).status).toBe("unchanged");
    expect((await upsertJob(db, h, hRef, addDays(T0, 3))).status).toBe("unchanged");
    expect((await upsertJob(db, g, gRef, addDays(T0, 4))).status).toBe("unchanged");
  });

  it("não insere vaga nova com mais de 45 dias; com 44 dias insere", async () => {
    const db = await testDb();
    const old = await upsertJob(db, makeJob({ publishedAt: addDays(T0, -46) }), ref, T0);
    expect(old).toEqual({ jobId: null, status: "skipped" });
    expect(await db.select().from(jobs)).toHaveLength(0);
    expect(await db.select().from(jobSources)).toHaveLength(0);
    const ok = await upsertJob(db, makeJob({ publishedAt: addDays(T0, -44) }), ref, T0);
    expect(ok.status).toBe("inserted");
  });
});
