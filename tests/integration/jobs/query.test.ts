import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { jobs, jobSources } from "@/lib/server/db/schema";
import { decodeCursor } from "@/lib/server/jobs/cursor";
import { getJob, InvalidCursorError, listJobs } from "@/lib/server/jobs/query";
import { jobsQuerySchema, type JobsQuery } from "@/lib/shared/schemas/jobs-query";
import type { JobSummary, SourceId, WorkMode } from "@/lib/shared/types/job";
import { resetDb, testDb } from "../setup";

const NOW = Date.now();
const HOUR = 3_600_000;

const q = (over: Partial<JobsQuery>): JobsQuery => jobsQuerySchema.parse(over);

const STACK_SETS = [
  ["react", "typescript"],
  ["vue"],
  ["react", "vue"],
  ["python", "django"],
  ["react", "typescript", "node"],
];
const MODES: WorkMode[] = ["remote", "hybrid", "onsite", "remote"];
const SOURCES: SourceId[] = ["lever", "ashby", "greenhouse"];
const SENIORITIES = ["junior", "mid", "senior", null] as const;
const LANGS = ["pt", "en", "es"];

async function seed() {
  const db = await testDb();
  for (let i = 0; i < 40; i++) {
    // Empates intencionais: de 4 em 4 vagas, o mesmo published_at.
    const publishedAt = new Date(NOW - Math.floor(i / 4) * 5 * HOUR);
    const stacks = STACK_SETS[i % STACK_SETS.length];
    const title = i === 7 ? "Engenheiro de programação" : `Dev ${i}`;
    const [row] = await db
      .insert(jobs)
      .values({
        dedupeKey: `dk-${i}`,
        urlCanonical: `https://example.com/j/${i}`,
        title,
        company: `Empresa ${i % 5}`,
        descriptionHtml: i === 7 ? "<p>Curso de programação</p>" : "<p>texto</p>",
        sanitizerVersion: 1,
        origin: i % 2 === 0 ? "national" : "international",
        acceptsBrazil: i % 3 === 0,
        workMode: MODES[i % MODES.length],
        seniority: SENIORITIES[i % SENIORITIES.length],
        language: LANGS[i % LANGS.length],
        stacks,
        sources: [SOURCES[i % SOURCES.length]],
        publishedAt,
        contentHash: `h-${i}`,
        searchVector: sql`job_search_vector(${title}, ${`Empresa ${i % 5}`}, ${sql.raw(`ARRAY[${stacks.map((s) => `'${s}'`).join(",")}]::text[]`)}, ${LANGS[i % LANGS.length]}, ${i === 7 ? "Curso de programação" : "texto"})`,
      })
      .returning({ id: jobs.id });
    await db.insert(jobSources).values({
      source: SOURCES[i % SOURCES.length],
      externalId: `ext-${i}`,
      jobId: Number(row.id),
      url: `https://${SOURCES[i % SOURCES.length]}.example.com/${i}`,
    });
  }
  // Expiradas: nunca devem aparecer.
  for (let i = 0; i < 5; i++) {
    await db.insert(jobs).values({
      dedupeKey: `exp-${i}`,
      urlCanonical: `https://example.com/exp/${i}`,
      title: "Expirada programação",
      company: "Velha",
      descriptionHtml: "<p>x</p>",
      sanitizerVersion: 1,
      workMode: "remote",
      stacks: ["react"],
      sources: ["lever"],
      publishedAt: new Date(NOW),
      contentHash: `e-${i}`,
      expiredAt: new Date(NOW),
      searchVector: sql`job_search_vector('Expirada programação', 'Velha', ARRAY['react']::text[], 'pt', 'x')`,
    });
  }
}

const isSortedDesc = (items: JobSummary[]) =>
  items.every((j, i) => {
    if (i === 0) return true;
    const p = items[i - 1];
    const a = Date.parse(p.publishedAt);
    const b = Date.parse(j.publishedAt);
    return a > b || (a === b && p.id > j.id);
  });

describe("listJobs", () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
  });

  it("pagina com cursor, sem repetir nem pular, e conta", async () => {
    const db = await testDb();
    const p1 = await listJobs(db, q({}), true);
    expect(p1.items).toHaveLength(30);
    expect(isSortedDesc(p1.items)).toBe(true);
    expect(p1.counts).toEqual({ all: 40, remote: 20, hybrid: 10, onsite: 10 });
    expect(p1.nextCursor).not.toBeNull();
    expect(decodeCursor(p1.nextCursor!)).not.toBeNull();

    const p2 = await listJobs(db, q({ cursor: p1.nextCursor! }), false);
    expect(p2.items).toHaveLength(10);
    expect(p2.counts).toBeUndefined();
    expect(p2.nextCursor).toBeNull();
    const ids1 = new Set(p1.items.map((j) => j.id));
    expect(p2.items.filter((j) => ids1.has(j.id))).toHaveLength(0);
    expect(isSortedDesc([...p1.items, ...p2.items])).toBe(true);
  });

  it("pagina com limit pequeno atravessando empates", async () => {
    const db = await testDb();
    const seen: number[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 50; guard++) {
      const page = await listJobs(db, q({ limit: 3, cursor }), false);
      seen.push(...page.items.map((j) => j.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(40);
    expect(new Set(seen).size).toBe(40);
  });

  it("filtro de stacks vazio (só stacks desconhecidas) não devolve nenhuma vaga", async () => {
    const db = await testDb();
    const r = await listJobs(db, q({ stacks: [], limit: 90 }), true);
    expect(r.items).toEqual([]);
    expect(r.nextCursor).toBeNull();
    expect(r.counts).toEqual({ all: 0, remote: 0, hybrid: 0, onsite: 0 });
  });

  it("cursor inválido lança InvalidCursorError em vez de voltar à página 1", async () => {
    const db = await testDb();
    await expect(listJobs(db, q({ cursor: "nao-e-cursor" }), false)).rejects.toBeInstanceOf(InvalidCursorError);
  });

  it("filtra stacks (any e all)", async () => {
    const db = await testDb();
    const any = await listJobs(db, q({ stacks: ["react", "vue"], limit: 90 }), false);
    expect(any.items.length).toBeGreaterThan(0);
    expect(any.items.every((j) => j.stacks.includes("react") || j.stacks.includes("vue"))).toBe(true);
    expect(any.items).toHaveLength(32);
    const all = await listJobs(db, q({ stacks: ["react", "typescript"], stacksMode: "all", limit: 90 }), false);
    expect(all.items).toHaveLength(16);
    expect(all.items.every((j) => j.stacks.includes("react") && j.stacks.includes("typescript"))).toBe(true);
  });

  it("filtra origem, acceptsBrazil, workMode, senioridade, idioma e fonte", async () => {
    const db = await testDb();
    const run = async (o: Partial<JobsQuery>) => (await listJobs(db, q({ ...o, limit: 90 }), false)).items;
    expect((await run({ origin: "national" })).every((j) => j.origin === "national")).toBe(true);
    expect(await run({ origin: "national" })).toHaveLength(20);
    const br = await run({ acceptsBrazil: true });
    expect(br.length).toBeGreaterThan(0);
    expect(br.every((j) => j.acceptsBrazil === true)).toBe(true);
    const remote = await run({ workMode: "remote" });
    expect(remote).toHaveLength(20);
    expect(remote.every((j) => j.workMode === "remote")).toBe(true);
    const sen = await run({ seniority: ["junior", "senior"] });
    expect(sen.length).toBeGreaterThan(0);
    expect(sen.every((j) => j.seniority === "junior" || j.seniority === "senior")).toBe(true);
    const pt = await run({ lang: "pt" });
    expect(pt.length).toBeGreaterThan(0);
    expect(pt.every((j) => j.language === "pt")).toBe(true);
    const src = await run({ source: ["lever", "ashby"] });
    expect(src.length).toBeGreaterThan(0);
    expect(src.every((j) => j.sources.some((s) => s === "lever" || s === "ashby"))).toBe(true);
  });

  it("filtra por since", async () => {
    const db = await testDb();
    const r = await listJobs(db, q({ since: "24h", limit: 90 }), false);
    // grupos 0..4 (0,5,10,15,20h) ficam dentro de 24h: 5 grupos x 4 vagas.
    expect(r.items).toHaveLength(20);
    const r7 = await listJobs(db, q({ since: "7d", limit: 90 }), false);
    expect(r7.items).toHaveLength(40);
  });

  it("os contadores ignoram o filtro workMode mas respeitam os demais", async () => {
    const db = await testDb();
    const r = await listJobs(db, q({ workMode: "remote", origin: "national" }), true);
    expect(r.counts).toEqual({ all: 20, remote: 10, hybrid: 0, onsite: 10 });
    expect(r.items.every((j) => j.workMode === "remote" && j.origin === "national")).toBe(true);
  });

  it("busca sem acento acha texto acentuado", async () => {
    const db = await testDb();
    const r = await listJobs(db, q({ q: "programacao" }), false);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.every((j) => j.title.includes("programação"))).toBe(true);
    expect((await listJobs(db, q({ q: "programação" }), false)).items).toHaveLength(1);
  });

  it("entradas hostis de busca não quebram", async () => {
    const db = await testDb();
    for (const s of ["C#", "node.js", '"São Paulo"', "'", "&", "   ", "a | b ! (", "\\", ":*"]) {
      await expect(listJobs(db, { ...q({}), q: s }, false)).resolves.toBeDefined();
    }
  });

  it("nunca devolve vagas expiradas", async () => {
    const db = await testDb();
    const r = await listJobs(db, q({ limit: 90 }), true);
    expect(r.items).toHaveLength(40);
    expect(r.items.some((j) => j.company === "Velha")).toBe(false);
    expect(r.counts!.all).toBe(40);
    expect((await listJobs(db, q({ q: "expirada" }), false)).items).toHaveLength(0);
  });

  it("não expõe description_html na listagem", async () => {
    const db = await testDb();
    const r = await listJobs(db, q({ limit: 1 }), false);
    expect(r.items[0]).not.toHaveProperty("descriptionHtml");
    expect(typeof r.items[0].publishedAt).toBe("string");
  });
});

describe("getJob", () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
  });

  it("devolve detalhe com atribuição por fonte", async () => {
    const db = await testDb();
    const [row] = await db.select({ id: jobs.id }).from(jobs).where(sql`dedupe_key = 'dk-0'`);
    const d = await getJob(db, Number(row.id));
    expect(d).not.toBeNull();
    expect(d!.descriptionHtml).toBe("<p>texto</p>");
    expect(d!.attribution).toEqual([
      { source: "lever", label: "lever", url: "https://lever.example.com/0", dofollow: false },
    ]);
    const d2 = await getJob(db, Number(row.id), (s) => ({ label: `Fonte ${s}`, dofollow: true }));
    expect(d2!.attribution[0]).toMatchObject({ label: "Fonte lever", dofollow: true });
  });

  it("applyUrl é a URL bruta da fonte vista por último, com os parâmetros intactos (D-07)", async () => {
    const db = await testDb();
    const [row] = await db.select({ id: jobs.id }).from(jobs).where(sql`dedupe_key = 'dk-0'`);
    const himalayasUrl = "https://himalayas.app/companies/acme/jobs/dev?utm_source=api";
    await db.insert(jobSources).values({
      source: "himalayas",
      externalId: "him-0",
      jobId: Number(row.id),
      url: himalayasUrl,
      lastSeenAt: new Date(NOW + HOUR),
    });
    const d = await getJob(db, Number(row.id));
    expect(d!.applyUrl).toBe(himalayasUrl);
    expect(d!.urlCanonical).toBe("https://example.com/j/0");
  });

  it("retorna null para id inexistente ou vaga expirada", async () => {
    const db = await testDb();
    expect(await getJob(db, 999_999)).toBeNull();
    const [exp] = await db.select({ id: jobs.id }).from(jobs).where(sql`dedupe_key = 'exp-0'`);
    expect(await getJob(db, Number(exp.id))).toBeNull();
  });
});
