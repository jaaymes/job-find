import { pickLanguage } from "@/lib/client/ai/prompts/cv.tailor.v1";
import { normalizeSkill } from "@/lib/shared/stacks";
import type { Profile } from "@/lib/shared/schemas/profile";
import type { JobDetail } from "@/lib/shared/types/job";
import type { CvTemplateId } from "./types";

/** Alguma palavra do título ou dos bullets da experiência é uma stack do dicionário? */
function mentionsStack(exp: Profile["experiences"][number]): boolean {
  const text = [exp.title, ...exp.bullets.map((b) => b.text)].join(" ");
  return text
    .split(/[^\p{L}\p{N}+#.]+/u)
    .some((w) => w !== "" && (normalizeSkill(w) ?? normalizeSkill(w.replace(/[.]+$/, ""))) !== null);
}

/**
 * Template recomendado (RN-31, D-06), na ordem: vaga em inglês, lead, junior/sem experiência, transição, senior.
 * `job === null` (CV base) conta como vaga em pt.
 */
export function recommendTemplate(profile: Profile, job: JobDetail | null): CvTemplateId {
  if (job !== null && pickLanguage(job) === "en") return "internacional";
  if (profile.seniority === "lead") return "lideranca";
  if (profile.seniority === "junior" || profile.experiences.length === 0) return "inicio-de-carreira";
  if (profile.projects.length >= 1 && !profile.experiences.some(mentionsStack)) return "transicao";
  if (profile.seniority === "senior") return "resultados";
  return "classico";
}
