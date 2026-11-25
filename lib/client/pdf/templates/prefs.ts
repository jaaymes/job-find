import "client-only";

import { createStore } from "@/lib/client/storage/store";
import type { Profile } from "@/lib/shared/schemas/profile";
import type { JobDetail } from "@/lib/shared/types/job";
import { z } from "@/lib/shared/zod";
import { recommendTemplate } from "./recommend";
import { CV_TEMPLATES } from "./registry";
import type { CvTemplateId } from "./types";

/** Preferência do usuário: template padrão dos próximos CVs (`null` = usa a recomendação). */
export const CvPrefs = z.object({ templateId: z.string().nullable() });
export type CvPrefs = z.infer<typeof CvPrefs>;

export const cvPrefsStore = createStore("jobfind:v1:cvPrefs", CvPrefs, {
  version: 1,
  initial: { templateId: null },
});

function validId(id: string | null | undefined): CvTemplateId | null {
  return CV_TEMPLATES.find((t) => t.id === id)?.id ?? null;
}

/** Registro do documento -> preferência -> recomendação. Um id inválido passa para o nível seguinte. */
export function resolveTemplateId(
  recordTemplateId: string | null | undefined,
  prefs: CvPrefs,
  profile: Profile,
  job: JobDetail,
): CvTemplateId {
  return validId(recordTemplateId) ?? validId(prefs.templateId) ?? recommendTemplate(profile, job);
}
