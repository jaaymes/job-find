import "client-only";

import { generateStructured, type GenerateArgs } from "@/lib/client/ai/generate";
import { CV_TAILOR_V1 } from "@/lib/client/ai/prompts/cv.tailor.v1";
import type { AiSettings } from "@/lib/client/ai/settings";
import type { SetResult, Store } from "@/lib/client/storage/store";
import type { Profile } from "@/lib/shared/schemas/profile";
import type { TailoredDocs } from "@/lib/shared/schemas/tailored";
import type { JobDetail } from "@/lib/shared/types/job";
import { generatedStore, type GeneratedRecord } from "./generated-store";
import type { CvLang } from "./period";
import { toPromptFeedback, validateTailored } from "./validate";

export type GenerateDocsArgs = {
  job: JobDetail;
  profile: Profile;
  settings: AiSettings;
  lang: CvLang;
  includeLetter: boolean;
  signal?: AbortSignal;
  onPartial?: (p: unknown) => void;
  now?: Date;
  store?: Store<Record<string, GeneratedRecord>>;
  resolveModel?: GenerateArgs<TailoredDocs>["resolveModel"];
};

/**
 * Gera o CV (e a carta, se pedida) adaptados à vaga (RF-17) e grava em `generatedDocs[jobId]`, trocando o registro
 * anterior (edições e aprovações vão embora). Só grava quando a geração termina: se falhar, lança e o registro
 * anterior, com as edições, fica intacto. Devolve o registro mesmo quando a gravação falha.
 *
 * RN-07: o validador roda uma vez como retentativa (o modelo recebe o feedback). Na segunda resposta ele aceita o
 * que vier, porque o que ainda violar não é descartado: a tela o destaca e o deixa fora do PDF até o usuário aprovar.
 */
export async function generateDocs(a: GenerateDocsArgs): Promise<{ record: GeneratedRecord; saved: SetResult }> {
  const now = a.now ?? new Date();
  let validations = 0;
  const { data, provider, model } = await generateStructured({
    task: "cv",
    settings: a.settings,
    system: CV_TAILOR_V1.system,
    prompt: CV_TAILOR_V1.buildUser({ profile: a.profile, job: a.job, lang: a.lang, withCoverLetter: a.includeLetter }),
    schema: CV_TAILOR_V1.schema,
    maxOutputTokens: CV_TAILOR_V1.maxOutputTokens,
    temperature: CV_TAILOR_V1.temperature,
    signal: a.signal,
    onPartial: a.onPartial,
    validate: (d) => (++validations > 1 ? [] : toPromptFeedback(validateTailored(a.profile, d, a.job))),
    resolveModel: a.resolveModel,
  });
  const record: GeneratedRecord = {
    cv: data.cv,
    coverLetter: a.includeLetter ? data.coverLetter : null,
    provider,
    model,
    promptVersion: CV_TAILOR_V1.version,
    createdAt: now.toISOString(),
    lang: a.lang,
    includeLetter: a.includeLetter,
    edits: null,
    approvedFlags: [],
  };
  const store = a.store ?? generatedStore;
  const saved = store.set({ ...store.get(), [String(a.job.id)]: record });
  return { record, saved };
}
