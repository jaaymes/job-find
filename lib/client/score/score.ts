import "client-only";

import type { Profile } from "@/lib/shared/schemas/profile";
import { extractStacks, normalizeSkill, STACKS } from "@/lib/shared/stacks";
import type { JobSummary } from "@/lib/shared/types/job";

// Score local de chance (RN-06, D-13): roda no navegador, sobre o perfil salvo, sem custo de IA.

export type Band = "alta" | "media" | "baixa";
export type Criterion = "stack" | "seniority" | "language" | "location" | "recency";
export type BreakdownItem = {
  criterion: Criterion;
  /** Peso nominal do critério (soma 100). O peso efetivo é redistribuído entre os disponíveis. */
  weight: number;
  /** 0 a 100. */
  value: number;
  /** false quando falta dado na vaga ou no perfil: o critério fica fora da média. */
  available: boolean;
  reason: string;
};
export type ScoreResult = { score: number; band: Band; breakdown: BreakdownItem[] };

export const WEIGHTS: Record<Criterion, number> = { stack: 45, seniority: 20, language: 15, location: 15, recency: 5 };
export const BAND_ALTA_MIN = 70;
export const BAND_MEDIA_MIN = 40;

const DAY_MS = 86_400_000;
const SENIORITY_ORDER = ["intern", "junior", "mid", "senior", "lead"] as const;
const SENIORITY_PT: Record<(typeof SENIORITY_ORDER)[number], string> = {
  intern: "estágio",
  junior: "júnior",
  mid: "pleno",
  senior: "sênior",
  lead: "liderança",
};
/** Perfil com inglês de intermediário para cima atende vagas em inglês. */
const ENGLISH_OK = new Set(["intermediate", "advanced", "fluent"]);

const STACK_BY_ID = new Map(STACKS.map((s) => [s.id, s]));

export type ProfileIndex = {
  /** stackId -> anos de experiência (null = não informado). */
  skills: Map<string, number | null>;
  seniority: Profile["seniority"];
  englishLevel: Profile["englishLevel"];
  /** Localização normalizada (minúsculas, sem acento). */
  location: string | null;
};

export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function indexProfile(p: Profile): ProfileIndex {
  const skills = new Map<string, number | null>();
  for (const s of p.skills) {
    const id = s.stackId ?? normalizeSkill(s.name);
    if (!id) continue;
    const prev = skills.get(id);
    // Duplicatas ficam com o maior número de anos.
    if (prev === undefined || (s.years ?? -1) > (prev ?? -1)) skills.set(id, s.years);
  }
  return {
    skills,
    seniority: p.seniority,
    englishLevel: p.englishLevel,
    location: p.location?.trim() ? normalizeText(p.location) : null,
  };
}

export function bandFor(score: number): Band {
  return score >= BAND_ALTA_MIN ? "alta" : score >= BAND_MEDIA_MIN ? "media" : "baixa";
}

/** Só para testes: esvazia o cache de stacks por título. */
export function resetTitleCacheForTests(): void {
  titleCache.clear();
}

// Stacks no título, por texto de título: a extração é cara (centenas de regex) e os títulos se repetem.
const titleCache = new Map<string, Set<string>>();
function titleStacks(title: string): Set<string> {
  let hit = titleCache.get(title);
  if (!hit) {
    hit = new Set(extractStacks({ title }).filter((s) => s.inTitle).map((s) => s.id));
    if (titleCache.size >= 2000) titleCache.clear();
    titleCache.set(title, hit);
  }
  return hit;
}

/** Fator de 0,6 a 1 pelos anos na stack: 3 anos ou mais = 1; sem a informação = 0,8. */
function experienceFactor(years: number | null): number {
  if (years === null) return 0.8;
  return 0.6 + 0.4 * Math.min(Math.max(years, 0), 3) / 3;
}

function stackItem(pi: ProfileIndex, job: JobSummary): BreakdownItem {
  const base = { criterion: "stack" as const, weight: WEIGHTS.stack };
  if (job.stacks.length === 0) {
    return { ...base, value: 0, available: false, reason: "A vaga não lista tecnologias." };
  }
  const inTitle = titleStacks(job.title);
  let total = 0;
  let earned = 0;
  const matched: string[] = [];
  const partial: string[] = [];
  const missing: string[] = [];
  for (const id of job.stacks) {
    const def = STACK_BY_ID.get(id);
    const label = def?.label ?? id;
    const w = (def?.weight ?? 1) * (inTitle.has(id) ? 2 : 1);
    total += w;
    if (pi.skills.has(id)) {
      earned += w * experienceFactor(pi.skills.get(id) ?? null);
      matched.push(label);
    } else if (def?.adjacent?.some((a) => pi.skills.has(a))) {
      earned += w * 0.5 * experienceFactor(pi.skills.get(def.adjacent.find((a) => pi.skills.has(a))!) ?? null);
      partial.push(label);
    } else {
      missing.push(label);
    }
  }
  const parts: string[] = [];
  if (matched.length) parts.push(`Você tem: ${matched.join(", ")}.`);
  if (partial.length) parts.push(`Tecnologia parecida com a sua (crédito parcial): ${partial.join(", ")}.`);
  if (missing.length) parts.push(`Faltam no seu perfil: ${missing.join(", ")}.`);
  return { ...base, value: (earned / total) * 100, available: true, reason: parts.join(" ") };
}

function seniorityItem(pi: ProfileIndex, job: JobSummary): BreakdownItem {
  const base = { criterion: "seniority" as const, weight: WEIGHTS.seniority };
  if (!job.seniority) return { ...base, value: 0, available: false, reason: "A vaga não informa a senioridade." };
  if (!pi.seniority) return { ...base, value: 0, available: false, reason: "Seu perfil não informa a senioridade." };
  const diff = Math.abs(SENIORITY_ORDER.indexOf(job.seniority) - SENIORITY_ORDER.indexOf(pi.seniority));
  const value = diff === 0 ? 100 : diff === 1 ? 50 : 0;
  const reason =
    diff === 0
      ? `Nível igual ao seu (${SENIORITY_PT[job.seniority]}).`
      : `A vaga é de nível ${SENIORITY_PT[job.seniority]} e o seu perfil é ${SENIORITY_PT[pi.seniority]}.`;
  return { ...base, value, available: true, reason };
}

function languageItem(pi: ProfileIndex, job: JobSummary): BreakdownItem {
  const base = { criterion: "language" as const, weight: WEIGHTS.language };
  if (job.language !== "en") return { ...base, value: 100, available: true, reason: "A vaga não exige inglês." };
  if (!pi.englishLevel) return { ...base, value: 0, available: true, reason: "Vaga em inglês; seu perfil não informa nível de inglês." };
  const ok = ENGLISH_OK.has(pi.englishLevel);
  return {
    ...base,
    value: ok ? 100 : 0,
    available: true,
    reason: ok ? "A vaga é em inglês e o seu inglês é suficiente." : "A vaga é em inglês e o seu nível é abaixo de intermediário.",
  };
}

function locationItem(pi: ProfileIndex, job: JobSummary): BreakdownItem {
  const base = { criterion: "location" as const, weight: WEIGHTS.location };
  const inPerson = job.workMode === "hybrid" || job.workMode === "onsite";
  const city = job.city?.trim() ? normalizeText(job.city) : null;
  const sameCity = inPerson && city !== null && pi.location !== null && pi.location.includes(city);
  if (sameCity) return { ...base, value: 100, available: true, reason: "A vaga é na sua cidade." };
  if (job.acceptsBrazil === true) return { ...base, value: 100, available: true, reason: "A vaga aceita quem mora no Brasil." };
  if (job.acceptsBrazil === false) return { ...base, value: 0, available: true, reason: "A vaga não aceita quem mora no Brasil." };
  if (inPerson && city !== null && pi.location !== null) {
    return { ...base, value: 0, available: true, reason: "A vaga é presencial ou híbrida em outra cidade." };
  }
  return { ...base, value: 0, available: false, reason: "Não dá para saber se a vaga aceita o seu local." };
}

function recencyItem(job: JobSummary, now: Date): BreakdownItem {
  const base = { criterion: "recency" as const, weight: WEIGHTS.recency };
  const published = Date.parse(job.publishedAt);
  if (Number.isNaN(published)) return { ...base, value: 0, available: false, reason: "A vaga não tem data de publicação." };
  const days = Math.max(0, (now.getTime() - published) / DAY_MS);
  const value = days <= 3 ? 100 : days >= 30 ? 0 : (100 * (30 - days)) / 27;
  return {
    ...base,
    value,
    available: true,
    reason: days <= 3 ? "Publicada nos últimos 3 dias." : days >= 30 ? "Publicada há 30 dias ou mais." : `Publicada há ${Math.floor(days)} dias.`,
  };
}

/** `Σ wᵢ·sᵢ / Σ wᵢ` sobre os critérios disponíveis; sem nenhum disponível, o score é 0. */
export function scoreJob(pi: ProfileIndex, job: JobSummary, now: Date): ScoreResult {
  const breakdown = [
    stackItem(pi, job),
    seniorityItem(pi, job),
    languageItem(pi, job),
    locationItem(pi, job),
    recencyItem(job, now),
  ];
  let weights = 0;
  let sum = 0;
  for (const b of breakdown) {
    if (!b.available) continue;
    weights += b.weight;
    sum += b.weight * b.value;
  }
  const score = weights === 0 ? 0 : Math.round(sum / weights);
  return { score, band: bandFor(score), breakdown };
}
