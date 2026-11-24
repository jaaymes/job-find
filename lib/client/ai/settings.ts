import "client-only";

import { z } from "@/lib/shared/zod";
import { createStore } from "@/lib/client/storage/store";
import { safeUrl } from "@/lib/shared/url";
import { PROVIDER_IDS, PROVIDERS, type ProviderId } from "./providers";

const ProviderIdSchema = z.enum(PROVIDER_IDS);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

/** IA local só aceita HTTP em loopback (127.0.0.1, localhost); qualquer porta, igual à CSP (`cspHosts` do registro). */
export function isLoopbackBaseURL(input: string): boolean {
  const normalized = safeUrl(input, { allowHttp: true });
  if (!normalized) return false;
  const url = new URL(normalized);
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

const TaskChoice = z.object({ provider: ProviderIdSchema, model: z.string().min(1) }).nullable();

export const AiSettings = z
  .object({
    providers: z.partialRecord(
      ProviderIdSchema,
      z.object({
        key: z.string().optional(),
        baseURL: z.string().optional(),
        addedAt: z.string(),
        source: z.enum(["pkce", "paste"]),
        privacyAccepted: z.boolean().optional(),
        /** OpenRouter: aceitou o aviso dos modelos gratuitos (podem guardar, treinar com ou publicar o texto). */
        freeConsent: z.boolean().optional(),
      }),
    ),
    tasks: z.object({ extract: TaskChoice, analyze: TaskChoice, cv: TaskChoice }),
    dataCollectionDeny: z.boolean().default(true),
    /** Legado: ignorado. A redação de e-mail, telefone e endereço é sempre aplicada (D-11). */
    minimizePii: z.boolean().optional(),
  })
  .superRefine((s, ctx) => {
    for (const [id, cfg] of Object.entries(s.providers)) {
      if (cfg.baseURL === undefined) continue;
      // Só provedores com `editableBaseURL` aceitam endereço próprio (hoje, a IA local, só em loopback).
      const def = PROVIDERS[id as ProviderId];
      if (!def.editableBaseURL || (id === "local" && !isLoopbackBaseURL(cfg.baseURL))) {
        ctx.addIssue({
          code: "custom",
          path: ["providers", id, "baseURL"],
          message: "baseURL inválida: apenas a IA local aceita endereço próprio, e só em loopback",
        });
      }
    }
  });
export type AiSettings = z.infer<typeof AiSettings>;

export function defaultAiSettings(): AiSettings {
  return {
    providers: {},
    tasks: { extract: null, analyze: null, cv: null },
    dataCollectionDeny: true,
  };
}

export const aiSettingsStore = createStore("jobfind:v1:ai", AiSettings, {
  version: 1,
  initial: defaultAiSettings(),
});
