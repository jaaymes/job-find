import "client-only";

import { z } from "@/lib/shared/zod";
import { createStore } from "@/lib/client/storage/store";

/** Marca que o guia de primeira visita já foi visto (concluído ou pulado). `null`: ainda não viu. */
export const OnboardingState = z.object({ seenAt: z.string() }).nullable();
export type OnboardingState = z.infer<typeof OnboardingState>;

export const onboardingStore = createStore("jobfind:v1:onboarding", OnboardingState, {
  version: 1,
  initial: null,
});
