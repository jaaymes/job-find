import "server-only";
import type { SourceId } from "@/lib/shared/types/job";

/**
 * Confiança de cada fonte quando a mesma vaga chega por mais de uma (SEC: fusão por `dedupe_key`).
 * 3: ATS da própria empresa (só a empresa publica). 2: agregadores e job boards. 1: conteúdo livre de
 * usuário (comentário no HN, issue no GitHub), onde qualquer pessoa escreve empresa e cargo.
 * Uma fonte menos confiável nunca sobrescreve o conteúdo nem o link de candidatura de uma mais confiável.
 */
export const SOURCE_TRUST: Record<SourceId, 1 | 2 | 3> = {
  greenhouse: 3,
  lever: 3,
  ashby: 3,
  smartrecruiters: 3,
  gupy: 3,
  himalayas: 2,
  jobicy: 2,
  wwr: 2,
  remoteok: 2,
  fourdayweek: 2,
  getonboard: 2,
  arbeitnow: 2,
  linkedin: 2,
  hn: 1,
  github: 1,
};

export function trustOf(source: string): number {
  return Object.hasOwn(SOURCE_TRUST, source) ? SOURCE_TRUST[source as SourceId] : 0;
}
