import "client-only";

import { createStore, type Store } from "@/lib/client/storage/store";
import { TailoredDocs } from "@/lib/shared/schemas/tailored";
import { z } from "@/lib/shared/zod";

/**
 * Documentos gerados para uma vaga (RF-17). `cv` e `coverLetter` são o que o modelo devolveu e nunca mudam depois
 * de gravados. `edits` guarda o documento INTEIRO já editado pelo usuário (não um patch): `null` enquanto não
 * houve edição. O texto vigente é `edits ?? { cv, coverLetter }` (ver `docsOf`). `approvedFlags` são as chaves
 * de trecho (ver `flags.ts`) que o usuário aprovou com "Aprovar mesmo assim".
 */
export const GeneratedRecord = TailoredDocs.extend({
  provider: z.string(),
  model: z.string(),
  promptVersion: z.number(),
  createdAt: z.string(),
  lang: z.enum(["pt", "en", "es"]),
  includeLetter: z.boolean(),
  edits: TailoredDocs.nullable(),
  approvedFlags: z.array(z.string()),
});
export type GeneratedRecord = z.infer<typeof GeneratedRecord>;

/** Texto vigente: as edições do usuário, ou o que o modelo gerou. */
export function docsOf(r: GeneratedRecord): TailoredDocs {
  return r.edits ?? { cv: r.cv, coverLetter: r.coverLetter };
}

/** Valida cada registro à parte: um registro corrompido some sozinho, sem levar os outros junto. */
const GeneratedRecords = z.record(z.string(), z.unknown()).transform((all) => {
  const ok: Record<string, GeneratedRecord> = {};
  for (const [id, raw] of Object.entries(all)) {
    const parsed = GeneratedRecord.safeParse(raw);
    if (parsed.success) ok[id] = parsed.data;
  }
  return ok;
});

/** Um único store, com todos os documentos: `jobId` -> registro. Módulo leve: não puxa o SDK de IA. */
export const generatedStore: Store<Record<string, GeneratedRecord>> = createStore(
  "jobfind:v1:generatedDocs",
  GeneratedRecords,
  { version: 1, initial: {} },
);
