import "server-only";
import { SOURCE_TRUST } from "@/lib/shared/sources";
import type { SourceId } from "@/lib/shared/types/job";

/**
 * Confiança de cada fonte quando a mesma vaga chega por mais de uma (SEC: fusão por `dedupe_key`).
 * 3: ATS da própria empresa (só a empresa publica). 2: agregadores e job boards. 1: conteúdo livre de
 * usuário (comentário no HN, issue no GitHub), onde qualquer pessoa escreve empresa e cargo.
 * Uma fonte menos confiável nunca sobrescreve o conteúdo nem o link de candidatura de uma mais confiável.
 */
export { SOURCE_TRUST };

export function trustOf(source: string): number {
  return Object.hasOwn(SOURCE_TRUST, source) ? SOURCE_TRUST[source as SourceId] : 0;
}
