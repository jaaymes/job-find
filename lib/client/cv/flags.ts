import "client-only";

import type { AssembledCv } from "./assemble";
import type { Violation } from "./validate";

/** FNV-1a de 32 bits sobre o texto normalizado (sem acento, minúsculo, espaços colapsados), em base 36. */
export function textHash(text: string): string {
  const s = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Chaves estáveis dos trechos. Todas terminam em `:<hash do texto>`: se o texto mudar (regeneração ou edição),
 * a aprovação guardada em `approvedFlags` deixa de valer.
 * ATENÇÃO (Tarefa 34): como o hash segue o texto, TODA edição do usuário exige rodar `validateTailored` de novo e
 * só então `assembleCv(..., { violations, approvedFlags })`; violações antigas têm chave do texto antigo.
 * - bullet: `${expId}@${ocorrência}#${bulletIndex}:${hash}` (a ocorrência separa um `expId` repetido);
 * - `cv#headline:h`, `cv#summary:h`, `cv#skill#${i}:h`, `letter:h`.
 */
export function bulletKey(expId: string, occurrence: number, bulletIndex: number, text: string): string {
  return `${expId}@${occurrence}#${bulletIndex}:${textHash(text)}`;
}
/** Chave de nível de experiência (`expId` desconhecido ou repetido): não aprovável. */
export function experienceKey(expId: string, occurrence: number): string {
  return `${expId}@${occurrence}`;
}
export const headlineKey = (text: string) => `cv#headline:${textHash(text)}`;
export const summaryKey = (text: string) => `cv#summary:${textHash(text)}`;
export const skillKey = (index: number, name: string) => `cv#skill#${index}:${textHash(name)}`;
export const letterKey = (text: string) => `letter:${textHash(text)}`;

/** Chave do trecho que a violação aponta (a mesma que vai para `approvedFlags`). */
export function violationKey(v: Violation): string {
  return v.key;
}

/** Estado de um trecho: `flagged` = tem violação ainda não aprovada (destacar e deixar fora do PDF). */
export type ItemFlag = { key: string; flagged: boolean; violations: Violation[] };

export function itemFlag(key: string, violations: Violation[], approvedFlags: string[] = []): ItemFlag {
  const mine = violations.filter((v) => v.key === key);
  return { key, flagged: mine.length > 0 && !approvedFlags.includes(key), violations: mine };
}

/**
 * Estado da carta. `key` (use-a em `approvedFlags` para "Aprovar mesmo assim") só existe quando há violações.
 */
export function letterFlags(violations: Violation[], approvedFlags: string[] = []): { key: string | null; flagged: boolean; violations: Violation[] } {
  const mine = violations.filter((v) => v.where.part === "letter");
  const key = mine[0]?.key ?? null;
  return { key, flagged: key !== null && !approvedFlags.includes(key), violations: mine };
}

/**
 * Aplica o resultado da validação (RN-07, camada 3) ao CV montado. Pura: devolve um novo CV.
 * - `bullets[].flagged`, `flags.headline`, `flags.summary` e `flags.skills[i]`: violação ainda não aprovada.
 *   Destacar, contar (`countFlagged`) e deixar fora do PDF. `violations` traz os motivos, mesmo após aprovar.
 * - Violação de experiência (`expId` desconhecido ou repetido) marca todos os bullets daquela ocorrência e
 *   NÃO é aprovável.
 */
export function flagBullets(cv: AssembledCv, violations: Violation[], approvedFlags: string[] = []): AssembledCv {
  const approved = new Set(approvedFlags);
  return {
    ...cv,
    experiences: cv.experiences.map((exp) => {
      const expViolations = violations.filter((v) => v.key === experienceKey(exp.expId, exp.occurrence));
      return {
        ...exp,
        bullets: exp.bullets.map((b) => {
          const mine = violations.filter((v) => v.key === b.key);
          return {
            ...b,
            violations: [...expViolations, ...mine],
            flagged: expViolations.length > 0 || (mine.length > 0 && !approved.has(b.key)),
          };
        }),
      };
    }),
    flags: {
      headline: itemFlag(headlineKey(cv.headline), violations, approvedFlags),
      summary: itemFlag(summaryKey(cv.summary), violations, approvedFlags),
      skills: cv.skills.map((s, i) => itemFlag(skillKey(i, s), violations, approvedFlags)),
    },
  };
}

/** Quantos trechos do CV ainda precisam de revisão (banner da Tarefa 34; some a carta com `letterFlags`). */
export function countFlagged(cv: AssembledCv): number {
  const { headline, summary, skills } = cv.flags;
  return (
    cv.experiences.reduce((n, e) => n + e.bullets.filter((b) => b.flagged).length, 0) +
    [headline, summary, ...skills].filter((f) => f.flagged).length
  );
}
