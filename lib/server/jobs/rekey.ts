import "server-only";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/server/db/client";
import { jobs } from "@/lib/server/db/schema";
import { canonicalUrl } from "@/lib/server/enrich/canonical-url";
import { dedupeKey } from "@/lib/server/enrich/dedupe";
import { mergeJobs } from "@/lib/server/jobs/merge";
import { UNKNOWN_COMPANY } from "@/lib/server/sources/types";
import type { WorkMode } from "@/lib/shared/types/job";

export type RekeyRow = {
  id: number;
  company: string;
  title: string;
  country: string | null;
  city: string | null;
  workMode: WorkMode;
  dedupeKey: string;
  urlCanonical: string;
};

export type RekeyGroup = { ids: number[]; next: Record<number, { dedupeKey: string; urlCanonical: string }> };

/**
 * Vagas ativas que entram no recálculo (D-05). As de empresa vazia ou desconhecida ficam de fora:
 * a chave delas vem do `external_id`, não da fórmula de empresa + título.
 */
export async function loadRekeyRows(db: Db): Promise<RekeyRow[]> {
  return db
    .select({
      id: jobs.id,
      company: jobs.company,
      title: jobs.title,
      country: jobs.country,
      city: jobs.city,
      workMode: jobs.workMode,
      dedupeKey: jobs.dedupeKey,
      urlCanonical: jobs.urlCanonical,
    })
    .from(jobs)
    .where(and(isNull(jobs.expiredAt), ne(jobs.company, ""), ne(jobs.company, UNKNOWN_COMPANY)))
    .orderBy(jobs.id);
}

/**
 * `url_canonical` das vagas ativas que ficam fora do recálculo (empresa vazia ou desconhecida).
 * Elas continuam ativas, então nenhuma vaga recalculada pode passar a usar uma dessas URLs.
 */
export async function loadReservedUrls(db: Db): Promise<Set<string>> {
  const rows = await db
    .select({ urlCanonical: jobs.urlCanonical })
    .from(jobs)
    .where(and(isNull(jobs.expiredAt), or(eq(jobs.company, ""), eq(jobs.company, UNKNOWN_COMPANY))));
  return new Set(rows.map((r) => r.urlCanonical));
}

/** URL a gravar: a canônica, salvo quando `canonicalUrl` a rejeita ou ela já pertence a uma vaga excluída. */
function nextUrl(row: RekeyRow, reservedUrls: ReadonlySet<string>): { url: string; conflict: boolean } {
  const canonical = canonicalUrl(row.urlCanonical) ?? row.urlCanonical;
  const conflict = canonical !== row.urlCanonical && reservedUrls.has(canonical);
  return { url: conflict ? row.urlCanonical : canonical, conflict };
}

/** Ids das linhas cuja URL nova colide com a de uma vaga excluída e, por isso, mantêm a URL gravada. */
export function findReservedConflicts(rows: RekeyRow[], reservedUrls: ReadonlySet<string>): number[] {
  return rows.filter((r) => nextUrl(r, reservedUrls).conflict).map((r) => r.id);
}

/**
 * Calcula a chave e a URL novas de cada linha e agrupa por união transitiva (mesma chave nova ou
 * mesma URL nova). Devolve os grupos com mais de uma vaga e os de uma vaga só cuja chave ou URL mudou,
 * com os ids em ordem crescente. URL gravada que `canonicalUrl` rejeita é mantida como está, e também
 * a que colidiria com `reservedUrls` (o agrupamento usa então a URL mantida).
 */
export function planRekey(rows: RekeyRow[], reservedUrls: ReadonlySet<string> = new Set()): RekeyGroup[] {
  const next = rows.map((r) => ({
    dedupeKey: dedupeKey(r),
    urlCanonical: nextUrl(r, reservedUrls).url,
  }));

  // União-busca sobre os índices de `rows`.
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const firstByKey = new Map<string, number>();
  const firstByUrl = new Map<string, number>();
  next.forEach((n, i) => {
    const byKey = firstByKey.get(n.dedupeKey);
    if (byKey === undefined) firstByKey.set(n.dedupeKey, i);
    else union(byKey, i);
    const byUrl = firstByUrl.get(n.urlCanonical);
    if (byUrl === undefined) firstByUrl.set(n.urlCanonical, i);
    else union(byUrl, i);
  });

  const members = new Map<number, number[]>();
  rows.forEach((_, i) => {
    const root = find(i);
    const list = members.get(root);
    if (list) list.push(i);
    else members.set(root, [i]);
  });

  const groups: RekeyGroup[] = [];
  for (const indexes of members.values()) {
    const changed = indexes.some(
      (i) => next[i].dedupeKey !== rows[i].dedupeKey || next[i].urlCanonical !== rows[i].urlCanonical,
    );
    if (indexes.length === 1 && !changed) continue;
    const sorted = [...indexes].sort((a, b) => rows[a].id - rows[b].id);
    groups.push({
      ids: sorted.map((i) => rows[i].id),
      next: Object.fromEntries(sorted.map((i) => [rows[i].id, next[i]])),
    });
  }
  return groups.sort((a, b) => a.ids[0] - b.ids[0]);
}

/**
 * Aplica o plano de `planRekey`. Primeiro grava valores provisórios (`'rekey:' || id`) em todas as
 * vagas de todos os grupos, para que nenhuma troca de chave ou URL entre vagas viole os índices
 * únicos das ativas no meio do caminho; depois funde cada grupo e grava a chave e a URL novas de
 * cada vaga (as perdedoras, já expiradas, também recebem as suas). `merged` conta as perdedoras; `rekeyed`, as sobreviventes gravadas.
 * Não abre transação: quem chama decide (o script passa um handle de transação).
 */
export async function applyRekey(
  db: Db,
  groups: RekeyGroup[],
  now: Date,
): Promise<{ merged: number; rekeyed: number }> {
  const allIds = groups.flatMap((g) => g.ids);
  if (allIds.length === 0) return { merged: 0, rekeyed: 0 };

  const provisional = sql`'rekey:' || ${jobs.id}`;
  await db.update(jobs).set({ dedupeKey: provisional, urlCanonical: provisional }).where(inArray(jobs.id, allIds));

  let merged = 0;
  let rekeyed = 0;
  for (const group of groups) {
    const survivor = group.ids.length > 1 ? await mergeJobs(db, group.ids, now) : group.ids[0];
    // Sobrevivente por último; as perdedoras já estão expiradas (fora dos índices parciais) e não
    // devem ficar com o valor provisório, que seria exibido como URL.
    for (const id of group.ids) {
      if (id !== survivor) await db.update(jobs).set(group.next[id]).where(eq(jobs.id, id));
    }
    await db.update(jobs).set(group.next[survivor]).where(eq(jobs.id, survivor));
    merged += group.ids.length - 1;
    rekeyed += 1;
  }
  return { merged, rekeyed };
}
