import "client-only";

import { createStore, type Store } from "@/lib/client/storage/store";
import { FitAnalysis } from "@/lib/shared/schemas/fit";
import { z } from "@/lib/shared/zod";

export const AnalysisRecord = FitAnalysis.extend({
  provider: z.string(),
  model: z.string(),
  promptVersion: z.number(),
  createdAt: z.string(),
});
export type AnalysisRecord = z.infer<typeof AnalysisRecord>;

/** Um único store, com todas as análises: `jobId` -> registro. Módulo leve: não puxa o SDK de IA. */
export const analysisStore: Store<Record<string, AnalysisRecord>> = createStore(
  "jobfind:v1:aiAnalysis",
  z.record(z.string(), AnalysisRecord),
  { version: 1, initial: {} },
);
