import "client-only";
import type { z } from "@/lib/shared/zod";

/** Prompt versionado: `system` fixo, `buildUser` monta a parte variável (sempre com texto não confiável delimitado). */
export type PromptDef<I, O> = {
  id: string;
  version: number;
  system: string;
  buildUser(i: I): string;
  schema: z.ZodType<O>;
  maxOutputTokens: number;
  temperature: number;
};
