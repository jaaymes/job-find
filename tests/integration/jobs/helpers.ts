import { eq } from "drizzle-orm";
import { jobs, jobSources } from "@/lib/server/db/schema";
import type { EnrichedJob } from "@/lib/server/jobs/enrich-job";
import type { testDb } from "../setup";

type TestDb = Awaited<ReturnType<typeof testDb>>;

export const T0 = new Date("2026-06-01T12:00:00.000Z");

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export function makeJob(over: Partial<EnrichedJob> = {}): EnrichedJob {
  return {
    dedupeKey: "dk-1",
    urlCanonical: "https://boards.example.com/acme/1",
    title: "Desenvolvedor React",
    company: "Acme",
    companyLogoUrl: null,
    summary: "Resumo",
    descriptionHtml: "<p>Vaga de React</p>",
    sanitizerVersion: 1,
    searchBody: "Vaga de React",
    country: "BR",
    city: "São Paulo",
    origin: "national",
    acceptsBrazil: true,
    workMode: "remote",
    seniority: "mid",
    language: "pt",
    stacks: ["react"],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    publishedAt: addDays(T0, -5),
    contentHash: "h1",
    ...over,
  };
}

export async function getRow(db: TestDb, id: number | null) {
  if (id === null) throw new Error("jobId nulo");
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row;
}

export async function getSource(db: TestDb, source: string, externalId: string) {
  const rows = await db.select().from(jobSources).where(eq(jobSources.externalId, externalId));
  return rows.find((r) => r.source === source);
}
