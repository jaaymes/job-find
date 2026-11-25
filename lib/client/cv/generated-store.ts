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
  /** Template do CV deste documento; `null` = usa a preferência do usuário, depois a recomendação. */
  templateId: z.string().nullable(),
});
export type GeneratedRecord = z.infer<typeof GeneratedRecord>;

/** Texto vigente: as edições do usuário, ou o que o modelo gerou. */
export function docsOf(r: GeneratedRecord): TailoredDocs {
  return r.edits ?? { cv: r.cv, coverLetter: r.coverLetter };
}

/** v1 -> v2: acrescenta `templateId: null` a cada registro. Registros que não são objetos passam intactos (o schema os descarta). */
export function migrateGeneratedV1toV2(old: unknown): unknown {
  if (old === null || typeof old !== "object" || Array.isArray(old)) return old;
  const out: Record<string, unknown> = {};
  for (const [id, rec] of Object.entries(old)) {
    const next = rec !== null && typeof rec === "object" && !Array.isArray(rec) ? { templateId: null, ...rec } : rec;
    Object.defineProperty(out, id, { value: next, enumerable: true, writable: true, configurable: true });
  }
  return out;
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
  { version: 2, migrations: { 1: migrateGeneratedV1toV2 }, initial: {} },
);
