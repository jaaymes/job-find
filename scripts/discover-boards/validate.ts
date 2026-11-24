import { classifyOrigin } from "@/lib/server/enrich/origin";
import { isTechJob } from "@/lib/server/enrich/tech";
import type { NormalizedJob } from "@/lib/server/sources/types";

/** Fração mínima de vagas de tecnologia (RN-01) para um board entrar só por ser tech. */
export const MIN_TECH_RATIO = 0.3;

export type BoardVerdict = { accept: boolean; tech: number; br: number; reason: string | null };

const letters = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** O nome devolvido pelo board precisa ter relação com o slug (evita um slug chutado cair noutra empresa). */
function nameMatchesSlug(slug: string, boardName: string | null): boolean {
  if (!boardName) return true;
  const name = letters(boardName);
  const key = letters(slug);
  if (!name || !key) return true;
  return name.includes(key) || key.includes(name);
}

/**
 * Aplica o filtro tech RN-01 ao resultado do `normalize` do conector. O `normalize` só valida o formato
 * (`null` = vaga fora do schema ou com URL inválida); quem decide "tecnologia" é `isTechJob`, na enriquecida.
 */
export function techOnly(job: NormalizedJob | null): NormalizedJob | null {
  return job && isTechJob(job.title, job.tags) ? job : null;
}

/**
 * Regra pura de aceite de um board descoberto. `normalized` é o resultado do `normalize` do próprio conector
 * sobre cada vaga crua (`null` = fora do filtro tech RN-01), para reaproveitar o filtro e o parser de local.
 * `br` usa `classifyOrigin`: país BR, local brasileiro ou região elegível que aceita o Brasil (Brasil, LatAm, mundo).
 */
export function acceptBoard(input: {
  slug: string;
  boardName: string | null;
  total: number;
  normalized: Array<NormalizedJob | null>;
}): BoardVerdict {
  if (input.total <= 0) return { accept: false, tech: 0, br: 0, reason: "sem vagas" };

  let tech = 0;
  let br = 0;
  for (const job of input.normalized) {
    if (!job) continue;
    tech++;
    const origin = classifyOrigin({
      country: job.country,
      locationText: job.locationText,
      eligibleRegions: job.eligibleRegions,
      sourceIsBrazilian: false,
    });
    if (origin.acceptsBrazil === true) br++;
  }

  if (!nameMatchesSlug(input.slug, input.boardName)) {
    return { accept: false, tech, br, reason: `nome do board ("${input.boardName}") não confere com o slug` };
  }
  if (tech === 0) return { accept: false, tech, br, reason: "nenhuma vaga de tecnologia" };
  if (tech / input.total >= MIN_TECH_RATIO) return { accept: true, tech, br, reason: null };
  if (br >= 1) return { accept: true, tech, br, reason: null };
  return { accept: false, tech, br, reason: "poucas vagas de tecnologia e nenhuma para o Brasil" };
}
