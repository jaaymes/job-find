import "client-only";

import DOMPurify from "dompurify";
import { PROVIDER_IDS, type ProviderId } from "@/lib/client/ai/providers";
import { AiSettings, aiSettingsStore } from "@/lib/client/ai/settings";
import { analysisStore, AnalysisRecord } from "@/lib/client/jobs/analysis-store";
import { JobState, jobStateStore } from "@/lib/client/jobs/job-state";
import { GeneratedRecord, generatedStore } from "@/lib/client/cv/generated-store";
import { profileStore } from "@/lib/client/profile/store";
import { Profile } from "@/lib/shared/schemas/profile";
import { DISCARD_CONTENT_TAGS } from "@/lib/shared/sanitize-policy";
import { safeUrl } from "@/lib/shared/url";
import { z } from "@/lib/shared/zod";
import type { StorageKey } from "./keys";

/** Limite do arquivo de backup (D-09): checado em `file.size`, antes de ler o conteúdo. */
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
export const BACKUP_FORMAT = "jobfind-backup";
export const BACKUP_VERSION = 1;

/** Chaves com store hoje. `savedFilters` e `lastVisit` ainda não têm schema (Task 41): são ignoradas. */
const AI = "jobfind:v1:ai" satisfies StorageKey;
const PROFILE = "jobfind:v1:profile" satisfies StorageKey;
const JOB_STATE = "jobfind:v1:jobState" satisfies StorageKey;
const ANALYSIS = "jobfind:v1:aiAnalysis" satisfies StorageKey;
const GENERATED = "jobfind:v1:generatedDocs" satisfies StorageKey;

export const BACKUP_KEYS = [AI, PROFILE, JOB_STATE, ANALYSIS, GENERATED] as const;
export type BackupKey = (typeof BACKUP_KEYS)[number];

export type BackupData = Partial<Record<BackupKey, unknown>>;
export type Backup = { format: typeof BACKUP_FORMAT; v: typeof BACKUP_VERSION; exportedAt: string; data: BackupData };

export type ParseResult =
  | {
      ok: true;
      backup: Backup;
      hasKeys: boolean;
      /** Provedor -> últimos 4 caracteres da chave. A chave completa nunca sai daqui. */
      keyHints: Partial<Record<ProviderId, string>>;
      /** Chaves do arquivo que serão substituídas (já validadas). */
      keys: BackupKey[];
      /** Chaves do arquivo que falharam na validação (ou ainda não são suportadas) e foram descartadas. */
      skipped: string[];
    }
  | { ok: false; reason: "too_large" | "invalid" };

// ---------------------------------------------------------------------------------------------------------------
// Schemas estritos (D-09): os mesmos schemas das stores, com `.strict()` em todos os objetos aninhados.
// A leitura normal das stores continua tolerante; só a importação rejeita campos desconhecidos.
// ---------------------------------------------------------------------------------------------------------------

type Def = Record<string, unknown> & { type: string };
type AnySchema = z.ZodType & { _zod: { def: Def }; clone: (def: Def) => z.ZodType };

function strictify(schema: z.ZodType): z.ZodType {
  const s = schema as AnySchema;
  const def = s._zod.def;
  switch (def.type) {
    case "object": {
      const shape = def.shape as Record<string, z.ZodType>;
      const next: Record<string, z.ZodType> = {};
      for (const k of Object.keys(shape)) next[k] = strictify(shape[k]);
      return s.clone({ ...def, shape: next, catchall: z.never() });
    }
    case "array":
      return s.clone({ ...def, element: strictify(def.element as z.ZodType) });
    case "record":
      return s.clone({ ...def, valueType: strictify(def.valueType as z.ZodType) });
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
      return s.clone({ ...def, innerType: strictify(def.innerType as z.ZodType) });
    default:
      return schema;
  }
}

const strict = {
  ai: strictify(AiSettings),
  profile: strictify(Profile.nullable()),
  jobState: z.record(z.string(), strictify(JobState)),
  analysis: z.record(z.string(), strictify(AnalysisRecord)),
  generated: z.record(z.string(), strictify(GeneratedRecord)),
};

const Envelope = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  v: z.literal(BACKUP_VERSION),
  exportedAt: z.string(),
  data: z.record(z.string(), z.unknown()),
});

// ---------------------------------------------------------------------------------------------------------------
// Sanitização do que entra (D-09, SEC-03): texto vira texto inerte; URL inválida é descartada ou vira null.
// ---------------------------------------------------------------------------------------------------------------

/** Remove marcação: `<img onerror=...>` vira nada, `<b>x</b>` vira `x`. Texto sem `<` passa intacto. */
export function stripMarkup(text: string): string {
  if (!text.includes("<")) return text;
  const stripped = DOMPurify.sanitize(text, {
    ALLOWED_TAGS: [],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true,
    FORBID_CONTENTS: [...DISCARD_CONTENT_TAGS],
  });
  // O DOMPurify devolve HTML serializado (`&amp;`); decodifica de volta para texto puro.
  const doc = new DOMParser().parseFromString(stripped, "text/html");
  return doc.body.textContent ?? "";
}

function deepText<T>(value: T): T {
  if (typeof value === "string") return stripMarkup(value) as T;
  if (Array.isArray(value)) return value.map(deepText) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      Object.defineProperty(out, k, { value: deepText(v), enumerable: true, writable: true, configurable: true });
    }
    return out as T;
  }
  return value;
}

function cleanUrl(url: string): string | null {
  return safeUrl(url, { allowHttp: true });
}

function sanitizeProfile(p: Profile | null): Profile | null {
  if (!p) return p;
  const clean = deepText(p);
  clean.contact.links = clean.contact.links.map(cleanUrl).filter((u): u is string => u !== null);
  return clean;
}

function sanitizeJobStates(all: Record<string, JobState>): Record<string, JobState> {
  const out: Record<string, JobState> = {};
  for (const [id, state] of Object.entries(all)) {
    // O id da chave tem de bater com o do snapshot (mesma regra da leitura).
    if (id !== String(state.snapshot.id)) throw new Error("jobState inconsistente");
    const clean = deepText(state);
    clean.snapshot.urlCanonical = clean.snapshot.urlCanonical === null ? null : cleanUrl(clean.snapshot.urlCanonical);
    Object.defineProperty(out, id, { value: clean, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

function sanitizeRecords<T>(all: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, rec] of Object.entries(all)) {
    Object.defineProperty(out, id, { value: deepText(rec), enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/** Valida (estrito) e sanitiza uma chave inteira; lança se qualquer parte falhar. */
function validateKey(key: BackupKey, raw: unknown): unknown {
  const must = <T>(schema: z.ZodType, value: unknown): T => {
    const r = schema.safeParse(value);
    if (!r.success) throw new Error("inválido");
    return r.data as T;
  };
  switch (key) {
    case AI: {
      const data = must<AiSettings>(strict.ai, raw);
      // Além da forma estrita, vale o schema da store (que traz as regras de baseURL).
      return must<AiSettings>(AiSettings, data);
    }
    case PROFILE:
      return sanitizeProfile(must<Profile | null>(strict.profile, raw));
    case JOB_STATE:
      return sanitizeJobStates(must<Record<string, JobState>>(strict.jobState, raw));
    case ANALYSIS:
      return sanitizeRecords(must<Record<string, AnalysisRecord>>(strict.analysis, raw));
    case GENERATED:
      return sanitizeRecords(must<Record<string, GeneratedRecord>>(strict.generated, raw));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Chaves de API
// ---------------------------------------------------------------------------------------------------------------

function providerKeys(ai: AiSettings): Partial<Record<ProviderId, string>> {
  const out: Partial<Record<ProviderId, string>> = {};
  for (const id of PROVIDER_IDS) {
    const key = ai.providers[id]?.key;
    if (typeof key === "string" && key !== "") out[id] = key;
  }
  return out;
}

/** Últimos 4 caracteres; chaves curtas demais não revelam nada. */
function hintOf(key: string): string {
  return key.length >= 8 ? key.slice(-4) : "••••";
}

function withoutKeys(ai: AiSettings): AiSettings {
  const providers: AiSettings["providers"] = {};
  for (const [id, cfg] of Object.entries(ai.providers)) {
    const { key: _key, ...rest } = cfg;
    void _key;
    Object.defineProperty(providers, id, { value: rest, enumerable: true, writable: true, configurable: true });
  }
  return { ...ai, providers };
}

// ---------------------------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------------------------

function storedKeys(): Set<StorageKey> {
  const present = new Set<StorageKey>();
  for (const key of BACKUP_KEYS) {
    try {
      if (window.localStorage.getItem(key) !== null) present.add(key);
    } catch {
      /* localStorage indisponível: nada a exportar */
    }
  }
  return present;
}

/** Nome do arquivo de backup: `jobfind-backup-AAAA-MM-DD.json`. */
export function backupFilename(now: Date = new Date()): string {
  return `jobfind-backup-${now.toISOString().slice(0, 10)}.json`;
}

/** Monta o arquivo de backup. Sem `includeKeys`, as chaves de TODOS os provedores ficam de fora (SEC-10). */
export function exportBackup(opts: { includeKeys: boolean }): Blob {
  const present = storedKeys();
  const data: Record<string, unknown> = {};
  if (present.has(AI)) {
    const ai = aiSettingsStore.get();
    data[AI] = opts.includeKeys ? ai : withoutKeys(ai);
  }
  if (present.has(PROFILE)) data[PROFILE] = profileStore.get();
  if (present.has(JOB_STATE)) data[JOB_STATE] = jobStateStore.get();
  if (present.has(ANALYSIS)) data[ANALYSIS] = analysisStore.get();
  if (present.has(GENERATED)) data[GENERATED] = generatedStore.get();
  const backup = { format: BACKUP_FORMAT, v: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
  return new Blob([JSON.stringify(backup)], { type: "application/json" });
}

function readText(file: Blob): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** Lê e valida o arquivo. Nada é gravado aqui; o resultado só traz dados já validados e sanitizados. */
export async function parseBackup(file: File): Promise<ParseResult> {
  if (file.size > MAX_BACKUP_BYTES) return { ok: false, reason: "too_large" };
  let json: unknown;
  try {
    json = JSON.parse(await readText(file));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const env = Envelope.safeParse(json);
  if (!env.success) return { ok: false, reason: "invalid" };

  // Só chaves conhecidas são lidas, por nome: `__proto__` e afins nunca viram atribuição.
  const data: BackupData = {};
  const keys: BackupKey[] = [];
  const skipped: string[] = [];
  const known = new Set<string>(BACKUP_KEYS);
  for (const name of Object.keys(env.data.data)) {
    if (!known.has(name)) {
      skipped.push(name);
      continue;
    }
    const key = name as BackupKey;
    try {
      data[key] = validateKey(key, Object.getOwnPropertyDescriptor(env.data.data, name)?.value);
      keys.push(key);
    } catch {
      skipped.push(name);
    }
  }
  if (keys.length === 0) return { ok: false, reason: "invalid" };

  const keyHints: Partial<Record<ProviderId, string>> = {};
  const ai = data[AI] as AiSettings | undefined;
  if (ai) for (const [id, key] of Object.entries(providerKeys(ai))) keyHints[id as ProviderId] = hintOf(key);

  return {
    ok: true,
    backup: { format: BACKUP_FORMAT, v: BACKUP_VERSION, exportedAt: env.data.exportedAt, data },
    hasKeys: Object.keys(keyHints).length > 0,
    keyHints,
    keys,
    skipped,
  };
}

/**
 * Grava cada chave inteira (sem deep merge). As configurações de IA só substituem as atuais com `acceptKeys` e se o
 * arquivo traz chaves: sem isso, todas as chaves e provedores existentes ficam exatamente como estão.
 * Devolve as chaves que não foram gravadas (cota cheia ou localStorage indisponível).
 */
export function applyBackup(b: Backup, opts: { acceptKeys: boolean }): BackupKey[] {
  const failed: BackupKey[] = [];
  const put = (key: BackupKey, ok: boolean) => {
    if (!ok) failed.push(key);
  };
  const d = b.data;
  if (d[AI] !== undefined) {
    const ai = d[AI] as AiSettings;
    if (opts.acceptKeys && Object.keys(providerKeys(ai)).length > 0) put(AI, aiSettingsStore.set(ai).ok);
  }
  if (d[PROFILE] !== undefined) put(PROFILE, profileStore.set(d[PROFILE] as Profile | null).ok);
  if (d[JOB_STATE] !== undefined) put(JOB_STATE, jobStateStore.set(d[JOB_STATE] as Record<string, JobState>).ok);
  if (d[ANALYSIS] !== undefined) put(ANALYSIS, analysisStore.set(d[ANALYSIS] as Record<string, AnalysisRecord>).ok);
  if (d[GENERATED] !== undefined) put(GENERATED, generatedStore.set(d[GENERATED] as Record<string, GeneratedRecord>).ok);
  return failed;
}
