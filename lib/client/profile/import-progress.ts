/**
 * Progresso estimado da importação do CV (spec 2026-11-24-modal-progresso-importacao, D-01/D-02).
 * A IA não informa o tamanho final da resposta, então a porcentagem é estimada por etapa:
 * leitura 0→15 e espera da IA 15→30 pelo tempo, resposta 30→95 pelo tamanho já recebido, fim 100.
 */

export type ImportPhase = "reading" | "waiting" | "streaming" | "done";
export type ProgressInput = { phase: ImportPhase; phaseStartedAt: number; cvLength: number; receivedChars: number };

const READING_TAU_MS = 1500;
const WAITING_TAU_MS = 8000;
const OUTPUT_FACTOR = 1.2;
const MIN_OUTPUT = 1500;
const MAX_OUTPUT = 40000;

/** Tamanho esperado do JSON do perfil: ~1,2× o texto do CV, entre 1.500 e 40.000 caracteres. */
export function expectedOutputChars(cvLength: number): number {
  return Math.min(MAX_OUTPUT, Math.max(MIN_OUTPUT, cvLength * OUTPUT_FACTOR));
}

/** Curva que se aproxima de 1 sem chegar (o limite evita que o float arredonde para 1 em `t` grande). */
const ease = (t: number, tau: number) => Math.min(0.999, 1 - Math.exp(-t / tau));

export function rawProgress(input: ProgressInput, now: number): number {
  const t = Math.max(0, now - input.phaseStartedAt);
  switch (input.phase) {
    case "reading":
      return 15 * ease(t, READING_TAU_MS);
    case "waiting":
      return 15 + 15 * ease(t, WAITING_TAU_MS);
    case "streaming":
      return 30 + 65 * Math.min(1, input.receivedChars / expectedOutputChars(input.cvLength));
    case "done":
      return 100;
  }
}

/** Valor exibido: inteiro e nunca menor que o anterior. */
export function nextProgress(prev: number, input: ProgressInput, now: number): number {
  return Math.max(prev, Math.round(rawProgress(input, now)));
}

export type FoundSummary = { experiences: number; skills: number; education: number; headline: string | null };

/** Lê o JSON parcial da IA (formato não confiável) só com guardas. */
export function summarizePartial(p: unknown): FoundSummary {
  const o = typeof p === "object" && p !== null && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  const headline = typeof o.headline === "string" && o.headline.trim() !== "" ? o.headline.trim() : null;
  return { experiences: count(o.experiences), skills: count(o.skills), education: count(o.education), headline };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function formatFound(s: FoundSummary): string | null {
  const parts = [
    s.experiences > 0 && plural(s.experiences, "experiência", "experiências"),
    s.skills > 0 && plural(s.skills, "competência", "competências"),
    s.education > 0 && plural(s.education, "formação", "formações"),
  ].filter((x): x is string => typeof x === "string");
  return parts.length === 0 ? null : `Encontrado até agora: ${parts.join(" · ")}`;
}
