import "client-only";

import { generateStructured, type GenerateArgs } from "@/lib/client/ai/generate";
import { JOB_FIT_V1 } from "@/lib/client/ai/prompts/job.fit.v1";
import type { AiSettings } from "@/lib/client/ai/settings";
import { indexProfile, scoreJob } from "@/lib/client/score/score";
import { createStore, type SetResult, type Store } from "@/lib/client/storage/store";
import { FitAnalysis, normalizeFit } from "@/lib/shared/schemas/fit";
import type { Profile } from "@/lib/shared/schemas/profile";
import { z } from "@/lib/shared/zod";
import type { JobDetail } from "@/lib/shared/types/job";

export const AnalysisRecord = FitAnalysis.extend({
  provider: z.string(),
  model: z.string(),
  promptVersion: z.number(),
  createdAt: z.string(),
});
export type AnalysisRecord = z.infer<typeof AnalysisRecord>;

/** Um único store, com todas as análises: `jobId` -> registro. */
export const analysisStore: Store<Record<string, AnalysisRecord>> = createStore(
  "jobfind:v1:aiAnalysis",
  z.record(z.string(), AnalysisRecord),
  { version: 1, initial: {} },
);

export type AnalyzeArgs = {
  job: JobDetail;
  profile: Profile;
  settings: AiSettings;
  signal?: AbortSignal;
  now?: Date;
  store?: Store<Record<string, AnalysisRecord>>;
  resolveModel?: GenerateArgs<FitAnalysis>["resolveModel"];
};

/**
 * Analisa a aderência do perfil à vaga com IA (RF-16) e grava o resultado em `aiAnalysis[jobId]`.
 * Devolve o registro mesmo quando a gravação falha (`saved.ok === false`): a tela mantém o resultado visível.
 */
export async function analyzeJob(a: AnalyzeArgs): Promise<{ record: AnalysisRecord; saved: SetResult }> {
  const now = a.now ?? new Date();
  const local = scoreJob(indexProfile(a.profile), a.job, now);
  const { data, provider, model } = await generateStructured({
    task: "analyze",
    settings: a.settings,
    system: JOB_FIT_V1.system,
    prompt: JOB_FIT_V1.buildUser({ profile: a.profile, job: a.job, local }),
    schema: JOB_FIT_V1.schema,
    maxOutputTokens: JOB_FIT_V1.maxOutputTokens,
    temperature: JOB_FIT_V1.temperature,
    signal: a.signal,
    resolveModel: a.resolveModel,
  });
  const record: AnalysisRecord = {
    ...normalizeFit(data),
    provider,
    model,
    promptVersion: JOB_FIT_V1.version,
    createdAt: now.toISOString(),
  };
  const store = a.store ?? analysisStore;
  const saved = store.set({ ...store.get(), [String(a.job.id)]: record });
  return { record, saved };
}
