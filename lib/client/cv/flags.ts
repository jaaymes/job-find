import "client-only";

import type { AssembledCv } from "./assemble";
import type { Violation } from "./validate";

/** Chave estável de um trecho (bullet) do CV: `${expId}#${bulletIndex}`. É o que `approvedFlags` guarda. */
export function bulletKey(expId: string, bulletIndex: number): string {
  return `${expId}#${bulletIndex}`;
}

/** Chave do trecho que uma violação aponta; null quando ela não é de um bullet (headline, summary, skills, carta). */
export function violationKey(v: Violation): string | null {
  const { expId, bulletIndex } = v.where;
  return v.where.part === "cv" && expId !== undefined && bulletIndex !== undefined ? bulletKey(expId, bulletIndex) : null;
}

/**
 * Aplica o resultado da validação (RN-07, camada 3) ao CV montado. Pura: devolve um novo CV.
 * - `flagged` = o bullet tem violação e NÃO foi aprovado. Destacar no editor, contar no banner
 *   ("N trechos precisam da sua revisão") e deixar fora do PDF.
 * - `violations` = por que o bullet foi marcado (mesmo depois de aprovado).
 * - Violação com `expId` e sem `bulletIndex` (experiência repetida) marca todos os bullets daquele `expId`.
 */
export function flagBullets(cv: AssembledCv, violations: Violation[], approvedFlags: string[] = []): AssembledCv {
  const approved = new Set(approvedFlags);
  return {
    ...cv,
    experiences: cv.experiences.map((exp) => ({
      ...exp,
      bullets: exp.bullets.map((b, i) => {
        const mine = violations.filter(
          (v) =>
            v.where.part === "cv" &&
            v.where.expId === exp.expId &&
            (v.where.bulletIndex === undefined || v.where.bulletIndex === i),
        );
        return { ...b, violations: mine, flagged: mine.length > 0 && !approved.has(b.key) };
      }),
    })),
  };
}

/** Quantos trechos ainda precisam de revisão (banner da Tarefa 34). */
export function countFlagged(cv: AssembledCv): number {
  return cv.experiences.reduce((n, e) => n + e.bullets.filter((b) => b.flagged).length, 0);
}
