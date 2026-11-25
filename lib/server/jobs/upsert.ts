import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db/client";
import { jobSources, jobs } from "@/lib/server/db/schema";
import type { SourceId } from "@/lib/shared/types/job";
import { trustOf } from "@/lib/server/sources/trust";
import type { EnrichedJob } from "./enrich-job";
import { MAX_AGE_DAYS } from "./expire";
import { mergeJobs } from "./merge";

const DAY_MS = 86_400_000;
/** RN-05: janela de deduplicação. */
const DEDUPE_WINDOW_DAYS = 30;

export type UpsertStatus = "inserted" | "updated" | "unchanged" | "skipped";

// O drizzle expande arrays JS em lista de parâmetros dentro de `sql`; aqui vai o literal do Postgres.
function pgArray(values: string[]): string {
  return `{${values.map((v) => `"${v.replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
}

const money = (v: number | null) => (v === null ? null : v.toFixed(2));

/** published_at: ausente vira o primeiro avistamento; datas futuras viram `now`. */
function clampPublished(publishedAt: Date | null, now: Date): Date {
  return publishedAt && publishedAt.getTime() < now.getTime() ? publishedAt : now;
}

/**
 * Grava a vaga (RF-02/RF-03). Resolve a vaga existente por (fonte, external_id),
 * depois por URL canônica e por fim por `dedupe_key` (janela de 30 dias); sem
 * nenhuma, insere. A linha de `jobs` só é reescrita se o conteúdo mudou ou se a
 * fonte é nova para ela; `job_sources` sempre recebe `last_seen_at = now`.
 * O conteúdo só é reescrito se a fonte for ao menos tão confiável quanto todas as que a vaga já tem
 * (`SOURCE_TRUST`): uma vaga postada no HN não troca a descrição de uma vaga vinda do ATS da empresa.
 * Se a atualização faria a chave ou a URL colidir com outra vaga ativa, as duas são a mesma vaga e
 * são fundidas (`mergeJobs`), desde que a fonte seja ao menos tão confiável quanto as de ambas;
 * senão a vaga mantém a chave/URL antiga e nada é fundido.
 */
export async function upsertJob(
  db: Db,
  job: EnrichedJob,
  ref: { source: SourceId; externalId: string; url: string },
  now: Date,
): Promise<{ jobId: number | null; status: UpsertStatus }> {
  const [bySource] = await db
    .select({ id: jobs.id })
    .from(jobSources)
    .innerJoin(jobs, eq(jobs.id, jobSources.jobId))
    .where(
      and(
        eq(jobSources.source, ref.source),
        eq(jobSources.externalId, ref.externalId),
        isNull(jobs.expiredAt),
      ),
    );
  let targetId: number | undefined = bySource?.id;

  if (targetId === undefined) {
    const [byUrl] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.urlCanonical, job.urlCanonical), isNull(jobs.expiredAt)));
    targetId = byUrl?.id;
  }

  let liveKeyMatch = false;
  let keyMatchId: number | undefined;
  if (targetId === undefined) {
    // Janela de 30 dias: um registro antigo com a mesma chave não absorve a vaga nova.
    const [byKey] = await db
      .select({ id: jobs.id, firstSeenAt: jobs.firstSeenAt })
      .from(jobs)
      .where(and(eq(jobs.dedupeKey, job.dedupeKey), isNull(jobs.expiredAt)));
    if (byKey && now.getTime() - byKey.firstSeenAt.getTime() > DEDUPE_WINDOW_DAYS * DAY_MS) {
      await db.update(jobs).set({ expiredAt: now }).where(eq(jobs.id, byKey.id));
    } else {
      liveKeyMatch = byKey !== undefined;
      keyMatchId = byKey?.id;
    }
  }

  // Fontes já ligadas à vaga existente: decidem se esta fonte pode reescrever o conteúdo.
  const existingId = targetId ?? keyMatchId;
  let canOverwrite = true;
  if (existingId !== undefined) {
    const [existing] = await db.select({ sources: jobs.sources }).from(jobs).where(eq(jobs.id, existingId));
    const incoming = trustOf(ref.source);
    canOverwrite = (existing?.sources ?? []).every((s) => trustOf(s) <= incoming);
  }

  const published = clampPublished(job.publishedAt, now);
  // Vaga nova já fora da validade de 45 dias: inserir só para expirar na próxima rodada geraria churn.
  if (
    targetId === undefined &&
    !liveKeyMatch &&
    now.getTime() - published.getTime() > MAX_AGE_DAYS * DAY_MS
  ) {
    return { jobId: null, status: "skipped" };
  }
  const stacksLiteral = pgArray(job.stacks);
  const searchVector = sql`job_search_vector(${job.title}, ${job.company}, ${stacksLiteral}::text[], ${job.language}, ${job.searchBody})`;
  const sourcesUnion = sql`ARRAY(SELECT DISTINCT s FROM unnest(${jobs.sources} || ARRAY[${ref.source}]::text[]) AS s ORDER BY s)`;
  const content = {
    title: job.title,
    company: job.company,
    companyLogoUrl: job.companyLogoUrl,
    summary: job.summary,
    descriptionHtml: job.descriptionHtml,
    sanitizerVersion: job.sanitizerVersion,
    country: job.country,
    city: job.city,
    origin: job.origin,
    acceptsBrazil: job.acceptsBrazil,
    workMode: job.workMode,
    seniority: job.seniority,
    language: job.language,
    salaryMin: money(job.salaryMin),
    salaryMax: money(job.salaryMax),
    salaryCurrency: job.salaryCurrency,
    salaryPeriod: job.salaryPeriod,
    contentHash: job.contentHash,
  };
  const newSource = sql`NOT (${ref.source} = ANY(${jobs.sources}))`;
  const changed = canOverwrite
    ? sql`${jobs.contentHash} IS DISTINCT FROM ${job.contentHash} OR ${newSource}`
    : newSource;
  // Fonte menos confiável: só entra na lista de fontes (e pode antecipar a data de publicação).
  const contentSet = canOverwrite
    ? { ...content, stacks: sql`${stacksLiteral}::text[]`, searchVector }
    : {};

  let jobId: number;
  let status: UpsertStatus;

  if (targetId !== undefined) {
    // Vaga já conhecida (mesma publicação ou mesma URL): atualização direta por id.
    // Se a nova chave ou URL já pertence a outra vaga ativa, as duas são a mesma vaga: funde.
    const [keyOwner] = await db
      .select({ id: jobs.id, sources: jobs.sources })
      .from(jobs)
      .where(and(eq(jobs.dedupeKey, job.dedupeKey), isNull(jobs.expiredAt)));
    const [urlOwner] = await db
      .select({ id: jobs.id, sources: jobs.sources })
      .from(jobs)
      .where(and(eq(jobs.urlCanonical, job.urlCanonical), isNull(jobs.expiredAt)));
    const colliding = [keyOwner, urlOwner].filter((o) => o !== undefined && o.id !== targetId);
    // Só funde se esta fonte é ao menos tão confiável quanto as de todas as vagas envolvidas.
    const incomingTrust = trustOf(ref.source);
    const canMerge =
      canOverwrite && colliding.every((o) => o.sources.every((s) => trustOf(s) <= incomingTrust));
    const merged = canMerge && colliding.length > 0;
    if (merged) {
      // O sobrevivente pode ser outra vaga que não a original; a atualização segue nele.
      targetId = await mergeJobs(db, [targetId, ...colliding.map((o) => o.id)], now);
    }
    const keyFree = canMerge || !keyOwner || keyOwner.id === targetId;
    const urlFree = canMerge || !urlOwner || urlOwner.id === targetId;
    const rows = await db
      .update(jobs)
      .set({
        ...contentSet,
        ...(canOverwrite && keyFree ? { dedupeKey: job.dedupeKey } : {}),
        ...(canOverwrite && urlFree ? { urlCanonical: job.urlCanonical } : {}),
        sources: sourcesUnion,
        publishedAt: sql`LEAST(${jobs.publishedAt}, ${published.toISOString()}::timestamptz)`,
        updatedAt: now,
      })
      .where(and(eq(jobs.id, targetId), isNull(jobs.expiredAt), merged ? sql`true` : sql`(${changed})`))
      .returning({ id: jobs.id });
    jobId = targetId;
    status = rows.length > 0 ? "updated" : "unchanged";
  } else {
    const rows = await db
      .insert(jobs)
      .values({
        ...content,
        dedupeKey: job.dedupeKey,
        urlCanonical: job.urlCanonical,
        stacks: sql`${stacksLiteral}::text[]`,
        sources: sql`ARRAY[${ref.source}]::text[]`,
        publishedAt: published,
        firstSeenAt: now,
        updatedAt: now,
        searchVector,
      })
      .onConflictDoUpdate({
        target: jobs.dedupeKey,
        targetWhere: isNull(jobs.expiredAt),
        set: {
          ...(canOverwrite ? { ...content, stacks: sql`${stacksLiteral}::text[]`, searchVector: sql`excluded.search_vector` } : {}),
          sources: sourcesUnion,
          publishedAt: sql`LEAST(${jobs.publishedAt}, excluded.published_at)`,
          updatedAt: now,
        },
        setWhere: sql`${changed}`,
      })
      .returning({ id: jobs.id, inserted: sql<boolean>`(xmax = 0)` });
    if (rows[0]) {
      jobId = rows[0].id;
      status = rows[0].inserted ? "inserted" : "updated";
    } else {
      // Conflito sem mudança: a linha existe e já está igual.
      const [existing] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.dedupeKey, job.dedupeKey), isNull(jobs.expiredAt)));
      if (!existing) throw new Error("upsertJob: vaga não encontrada após o conflito");
      jobId = existing.id;
      status = "unchanged";
    }
  }

  await db
    .insert(jobSources)
    .values({
      source: ref.source,
      externalId: ref.externalId,
      jobId,
      url: ref.url,
      firstSeenAt: now,
      lastSeenAt: now,
      missedRuns: 0,
    })
    .onConflictDoUpdate({
      target: [jobSources.source, jobSources.externalId],
      set: { jobId, url: ref.url, lastSeenAt: now, missedRuns: 0 },
    });

  return { jobId, status };
}
