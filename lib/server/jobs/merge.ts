import "server-only";
import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db/client";
import { jobSources, jobs } from "@/lib/server/db/schema";
import { trustOf } from "@/lib/server/sources/trust";

/**
 * Funde vagas ativas que são a mesma publicação (D-05) e devolve o id da sobrevivente.
 * Sobrevive a vaga com a fonte mais confiável; no empate, a vista primeiro (`first_seen_at`) e,
 * persistindo o empate, o menor id. As perdedoras são expiradas, suas ligações em `job_sources`
 * passam para a sobrevivente, e esta ganha a união das fontes e a menor data de publicação.
 * Não abre transação: quem chama decide (pode receber um handle de transação).
 */
export async function mergeJobs(db: Db, jobIds: number[], now: Date): Promise<number> {
  const ids = [...new Set(jobIds)];
  if (ids.length === 0) throw new Error("mergeJobs: nenhuma vaga informada");
  if (ids.length === 1) return ids[0];

  const rows = await db
    .select({ id: jobs.id, sources: jobs.sources, firstSeenAt: jobs.firstSeenAt })
    .from(jobs)
    .where(inArray(jobs.id, ids));
  if (rows.length !== ids.length) throw new Error("mergeJobs: vaga não encontrada");

  const trust = (sources: string[]) => Math.max(0, ...sources.map(trustOf));
  const [survivor, ...losers] = [...rows].sort(
    (a, b) =>
      trust(b.sources) - trust(a.sources) ||
      a.firstSeenAt.getTime() - b.firstSeenAt.getTime() ||
      a.id - b.id,
  );
  const loserIds = losers.map((l) => l.id);

  // Ordem importa: expirar antes de mover as fontes e de atualizar a sobrevivente.
  await db.update(jobs).set({ expiredAt: now }).where(inArray(jobs.id, loserIds));
  await db.update(jobSources).set({ jobId: survivor.id }).where(inArray(jobSources.jobId, loserIds));

  const allIds = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  await db
    .update(jobs)
    .set({
      sources: sql`ARRAY(SELECT DISTINCT s FROM (SELECT unnest(sources) AS s FROM jobs WHERE id IN (${allIds})) AS u ORDER BY s)`,
      publishedAt: sql`(SELECT MIN(published_at) FROM jobs WHERE id IN (${allIds}))`,
      updatedAt: now,
    })
    .where(eq(jobs.id, survivor.id));

  return survivor.id;
}
