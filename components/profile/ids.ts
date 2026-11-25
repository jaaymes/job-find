import type { MutableRefObject } from "react";

export const maxSeq = (ids: string[], re: RegExp): number =>
  ids.reduce((m, id) => Math.max(m, Number(re.exec(id)?.[1] ?? 0)), 0);

/**
 * Próximo número de um id sequencial (`exp_3`, `exp_1.b2`...). `seen` guarda o maior número já emitido (ou presente ao abrir)
 * no editor: apagar o último item e adicionar outro não reaproveita o id (análises e CVs antigos o referenciam).
 */
export function nextSeq(seen: MutableRefObject<number>, ids: string[], re: RegExp): number {
  seen.current = Math.max(seen.current, maxSeq(ids, re)) + 1;
  return seen.current;
}
