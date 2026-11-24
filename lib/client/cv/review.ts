import "client-only";

import type { Profile } from "@/lib/shared/schemas/profile";
import type { TailoredDocs } from "@/lib/shared/schemas/tailored";
import { type AssembledCv, assembleCv } from "./assemble";
import { countFlagged, letterFlags } from "./flags";
import type { CvLang } from "./period";
import { type JobContext, type Violation, validateTailored } from "./validate";

export type Review = {
  cv: AssembledCv;
  violations: Violation[];
  letter: { key: string | null; flagged: boolean; violations: Violation[] };
  /** Trechos que ainda precisam de revisão: CV mais a carta (conta como 1). */
  flaggedCount: number;
  /** Experiências geradas com `expId` fora do perfil: o `assembleCv` as pula. */
  removedExperiences: number;
};

/**
 * Revalida e remonta o documento. Deve rodar a CADA edição: as chaves dos trechos seguem o hash do texto, então
 * violações calculadas antes da edição não valem mais (e sem isso a edição contornaria o bloqueio do PDF).
 */
export function reviewDocs(
  profile: Profile,
  docs: TailoredDocs,
  lang: CvLang,
  approvedFlags: string[],
  job: JobContext,
): Review {
  const violations = validateTailored(profile, docs, job);
  const cv = assembleCv(profile, docs, lang, { violations, approvedFlags });
  const letter = letterFlags(violations, approvedFlags);
  return {
    cv,
    violations,
    letter,
    flaggedCount: countFlagged(cv) + (letter.flagged ? 1 : 0),
    removedExperiences: docs.cv.experiences.length - cv.experiences.length,
  };
}
