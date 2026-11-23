import "client-only";

import type { ProviderV4 } from "@ai-sdk/provider";
import { z } from "zod";
import { AiError } from "./errors";

export type AiTask = "extract" | "analyze" | "cv";

export const PROVIDER_IDS = [
  "openrouter",
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "local",
  "groq",
  "mistral",
  "cerebras",
  "xai",
  "together",
  "fireworks",
  "huggingface",
  "vercel-gateway",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** O AI SDK 7 usa a especificação V4 de provedor (a V3 é a do AI SDK 6). */
export type AiProvider = ProviderV4;

export type ProviderCfg = { apiKey?: string; baseURL?: string };
export type ModelInfo = { id: string; label: string; priceIn?: number; priceOut?: number };

export type ProviderDef = {
  id: ProviderId;
  label: string;
  tier: "must" | "should";
  baseURL: string;
  editableBaseURL: boolean;
  cors: "yes" | "needs-header" | "local-config";
  structured: "json_schema" | "tool" | "json_mode";
  auth: "pkce" | "paste" | "none";
  keyDocsUrl: string;
  privacyNote: string | null;
  cspHosts: string[];
  defaultModels: Record<AiTask, string>;
  create: (cfg: ProviderCfg) => Promise<AiProvider>;
  listModels: (cfg: ProviderCfg) => Promise<ModelInfo[]>;
};

// Valores de `structured` e ids de modelo provisórios até haver testes reais com cada provedor (o spike da Fase 0 não rodou).

const ANTHROPIC_HEADERS = { "anthropic-dangerous-direct-browser-access": "true" };

type LoopbackInit = RequestInit & { targetAddressSpace?: "loopback" };

/** Chrome 142+ exige `targetAddressSpace` para o Local Network Access (D-17). */
const loopbackFetch: typeof fetch = (input, init) => {
  const next: LoopbackInit = { ...init, targetAddressSpace: "loopback" };
  return fetch(input, next);
};

function openAICompatible(id: ProviderId, baseURL: string, extra?: { fetch?: typeof fetch }) {
  return async (cfg: ProviderCfg): Promise<AiProvider> => {
    const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
    return createOpenAICompatible({
      name: id,
      baseURL: cfg.baseURL ?? baseURL,
      apiKey: cfg.apiKey,
      ...extra,
    });
  };
}

// ---- listModels ----

const Entry = z.looseObject({ id: z.string() });
const OpenAIList = z.object({ data: z.array(z.unknown()) });
const OpenRouterEntry = z.looseObject({
  id: z.string(),
  name: z.string().optional(),
  pricing: z.looseObject({ prompt: z.string().optional(), completion: z.string().optional() }).optional(),
});
const AnthropicEntry = z.looseObject({ id: z.string(), display_name: z.string().optional() });
const GoogleList = z.object({
  models: z.array(
    z.looseObject({
      name: z.string(),
      displayName: z.string().optional(),
      supportedGenerationMethods: z.array(z.string()).optional(),
    }),
  ),
});

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (cause) {
    throw new AiError("unavailable", { retryable: true, cause });
  }
  if (res.status === 401 || res.status === 403) throw new AiError("invalid_key");
  if (!res.ok) {
    throw new AiError(res.status === 429 ? "rate_limit" : "unavailable", {
      retryable: true,
      meta: { status: res.status },
    });
  }
  try {
    return await res.json();
  } catch (cause) {
    throw new AiError("unavailable", { retryable: true, cause });
  }
}

function bearer(cfg: ProviderCfg): Record<string, string> {
  return cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};
}

/** Preço por token (texto) -> USD por milhão de tokens. */
function perMillion(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e4) / 1e4 : undefined;
}

function listOpenAIStyle(baseURL: string) {
  return async (cfg: ProviderCfg): Promise<ModelInfo[]> => {
    const body = OpenAIList.safeParse(await getJson(`${cfg.baseURL ?? baseURL}/models`, bearer(cfg)));
    if (!body.success) return [];
    return body.data.data.flatMap((e) => {
      const m = Entry.safeParse(e);
      return m.success ? [{ id: m.data.id, label: m.data.id }] : [];
    });
  };
}

async function listOpenRouter(cfg: ProviderCfg): Promise<ModelInfo[]> {
  const body = OpenAIList.safeParse(await getJson(`${PROVIDERS_BASE.openrouter}/models`, bearer(cfg)));
  if (!body.success) return [];
  return body.data.data.flatMap((e) => {
    const m = OpenRouterEntry.safeParse(e);
    if (!m.success) return [];
    return [
      {
        id: m.data.id,
        label: m.data.name ?? m.data.id,
        priceIn: perMillion(m.data.pricing?.prompt),
        priceOut: perMillion(m.data.pricing?.completion),
      },
    ];
  });
}

async function listAnthropic(cfg: ProviderCfg): Promise<ModelInfo[]> {
  const body = OpenAIList.safeParse(
    await getJson(`${PROVIDERS_BASE.anthropic}/models?limit=100`, {
      "x-api-key": cfg.apiKey ?? "",
      "anthropic-version": "2023-06-01",
      ...ANTHROPIC_HEADERS,
    }),
  );
  if (!body.success) return [];
  return body.data.data.flatMap((e) => {
    const m = AnthropicEntry.safeParse(e);
    return m.success ? [{ id: m.data.id, label: m.data.display_name ?? m.data.id }] : [];
  });
}

async function listGoogle(cfg: ProviderCfg): Promise<ModelInfo[]> {
  // A chave vai no header, nunca na URL.
  const body = GoogleList.safeParse(
    await getJson(`${PROVIDERS_BASE.google}/models?pageSize=1000`, { "x-goog-api-key": cfg.apiKey ?? "" }),
  );
  if (!body.success) return [];
  return body.data.models
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent") ?? true)
    .map((m) => {
      const id = m.name.replace(/^models\//, "");
      return { id, label: m.displayName ?? id };
    });
}

const PROVIDERS_BASE = {
  openrouter: "https://openrouter.ai/api/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
} as const;

const same = (m: string): Record<AiTask, string> => ({ extract: m, analyze: m, cv: m });

/** Define um provedor de nuvem via `openai-compatible` (entradas Should e DeepSeek). */
function compat(
  id: ProviderId,
  label: string,
  tier: "must" | "should",
  baseURL: string,
  host: string,
  keyDocsUrl: string,
  models: Record<AiTask, string>,
  structured: ProviderDef["structured"] = "json_mode",
): ProviderDef {
  return {
    id,
    label,
    tier,
    baseURL,
    editableBaseURL: false,
    cors: "yes",
    structured,
    auth: "paste",
    keyDocsUrl,
    privacyNote: null,
    cspHosts: [host],
    defaultModels: models,
    create: openAICompatible(id, baseURL),
    listModels: listOpenAIStyle(baseURL),
  };
}

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    tier: "must",
    baseURL: PROVIDERS_BASE.openrouter,
    editableBaseURL: false,
    cors: "yes",
    structured: "json_schema",
    auth: "pkce",
    keyDocsUrl: "https://openrouter.ai/docs/guides/overview/auth/oauth",
    privacyNote:
      "O OpenRouter encaminha o texto ao provedor do modelo; o app pede data_collection: deny por padrão.",
    cspHosts: ["https://openrouter.ai"],
    defaultModels: {
      extract: "deepseek/deepseek-v4.1-flash",
      analyze: "deepseek/deepseek-v4.1-flash",
      cv: "deepseek/deepseek-v4-pro",
    },
    create: async ({ apiKey }) => {
      const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
      const referer = typeof window === "undefined" ? undefined : window.location.origin;
      return createOpenRouter({
        apiKey,
        compatibility: "strict",
        headers: { ...(referer ? { "HTTP-Referer": referer } : {}), "X-OpenRouter-Title": "Job Find" },
      });
    },
    listModels: listOpenRouter,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    tier: "must",
    baseURL: "https://api.openai.com/v1",
    editableBaseURL: false,
    cors: "yes",
    structured: "json_schema",
    auth: "paste",
    keyDocsUrl: "https://platform.openai.com/api-keys",
    privacyNote: null,
    cspHosts: ["https://api.openai.com"],
    defaultModels: { extract: "gpt-5-mini", analyze: "gpt-5-mini", cv: "gpt-5" },
    create: async ({ apiKey }) => {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ apiKey });
    },
    listModels: listOpenAIStyle("https://api.openai.com/v1"),
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    tier: "must",
    baseURL: PROVIDERS_BASE.anthropic,
    editableBaseURL: false,
    cors: "needs-header",
    // structuredOutputMode 'auto' do SDK usa o formato nativo (json_schema) quando o modelo suporta.
    structured: "json_schema",
    auth: "paste",
    keyDocsUrl: "https://console.anthropic.com/settings/keys",
    privacyNote: null,
    cspHosts: ["https://api.anthropic.com"],
    defaultModels: { extract: "claude-haiku-4-5", analyze: "claude-haiku-4-5", cv: "claude-sonnet-4-5" },
    create: async ({ apiKey }) => {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({ apiKey, headers: ANTHROPIC_HEADERS });
    },
    listModels: listAnthropic,
  },
  google: {
    id: "google",
    label: "Google Gemini",
    tier: "must",
    baseURL: PROVIDERS_BASE.google,
    editableBaseURL: false,
    cors: "yes",
    structured: "json_schema",
    auth: "paste",
    keyDocsUrl: "https://aistudio.google.com/app/apikey",
    privacyNote:
      "No plano gratuito da API do Gemini, o Google pode usar os dados enviados para melhorar seus produtos.",
    cspHosts: ["https://generativelanguage.googleapis.com"],
    defaultModels: { extract: "gemini-2.5-flash", analyze: "gemini-2.5-flash", cv: "gemini-2.5-pro" },
    create: async ({ apiKey }) => {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI({ apiKey });
    },
    listModels: listGoogle,
  },
  deepseek: compat(
    "deepseek",
    "DeepSeek",
    "must",
    "https://api.deepseek.com/v1",
    "https://api.deepseek.com",
    "https://platform.deepseek.com/api_keys",
    same("deepseek-chat"),
  ),
  local: {
    id: "local",
    label: "IA local (Ollama / LM Studio) - experimental",
    tier: "must",
    baseURL: "http://127.0.0.1:11434/v1",
    editableBaseURL: true,
    cors: "local-config",
    structured: "json_mode",
    auth: "none",
    keyDocsUrl: "https://github.com/ollama/ollama/blob/main/docs/faq.md",
    privacyNote:
      "Os dados ficam na sua máquina. Exige liberar CORS no servidor local e a permissão de rede local do navegador.",
    cspHosts: ["http://127.0.0.1:*", "http://localhost:*"],
    defaultModels: same("llama3.2"),
    create: openAICompatible("local", "http://127.0.0.1:11434/v1", { fetch: loopbackFetch }),
    listModels: async (cfg) => {
      const base = cfg.baseURL ?? "http://127.0.0.1:11434/v1";
      let res: Response;
      try {
        res = await loopbackFetch(`${base}/models`, { headers: bearer(cfg) });
      } catch (cause) {
        throw new AiError("local_blocked", { cause });
      }
      if (!res.ok) throw new AiError("unavailable", { retryable: true, meta: { status: res.status } });
      const body = OpenAIList.safeParse(await res.json());
      if (!body.success) return [];
      return body.data.data.flatMap((e) => {
        const m = Entry.safeParse(e);
        return m.success ? [{ id: m.data.id, label: m.data.id }] : [];
      });
    },
  },
  groq: compat(
    "groq",
    "Groq",
    "should",
    "https://api.groq.com/openai/v1",
    "https://api.groq.com",
    "https://console.groq.com/keys",
    same("llama-3.3-70b-versatile"),
  ),
  mistral: {
    id: "mistral",
    label: "Mistral",
    tier: "should",
    baseURL: "https://api.mistral.ai/v1",
    editableBaseURL: false,
    cors: "yes",
    structured: "json_schema",
    auth: "paste",
    keyDocsUrl: "https://console.mistral.ai/api-keys",
    privacyNote: null,
    cspHosts: ["https://api.mistral.ai"],
    defaultModels: { extract: "mistral-small-latest", analyze: "mistral-small-latest", cv: "mistral-large-latest" },
    create: async ({ apiKey }) => {
      const { createMistral } = await import("@ai-sdk/mistral");
      return createMistral({ apiKey });
    },
    listModels: listOpenAIStyle("https://api.mistral.ai/v1"),
  },
  cerebras: compat(
    "cerebras",
    "Cerebras",
    "should",
    "https://api.cerebras.ai/v1",
    "https://api.cerebras.ai",
    "https://cloud.cerebras.ai/platform",
    same("llama-3.3-70b"),
  ),
  xai: compat(
    "xai",
    "xAI (Grok)",
    "should",
    "https://api.x.ai/v1",
    "https://api.x.ai",
    "https://console.x.ai",
    same("grok-4-fast"),
  ),
  together: compat(
    "together",
    "Together AI",
    "should",
    "https://api.together.xyz/v1",
    "https://api.together.xyz",
    "https://api.together.ai/settings/api-keys",
    same("meta-llama/Llama-3.3-70B-Instruct-Turbo"),
  ),
  fireworks: compat(
    "fireworks",
    "Fireworks AI",
    "should",
    "https://api.fireworks.ai/inference/v1",
    "https://api.fireworks.ai",
    "https://fireworks.ai/account/api-keys",
    same("accounts/fireworks/models/llama-v3p3-70b-instruct"),
  ),
  huggingface: compat(
    "huggingface",
    "Hugging Face",
    "should",
    "https://router.huggingface.co/v1",
    "https://router.huggingface.co",
    "https://huggingface.co/settings/tokens",
    same("meta-llama/Llama-3.3-70B-Instruct"),
  ),
  "vercel-gateway": compat(
    "vercel-gateway",
    "Vercel AI Gateway",
    "should",
    "https://ai-gateway.vercel.sh/v1",
    "https://ai-gateway.vercel.sh",
    "https://vercel.com/docs/ai-gateway",
    same("openai/gpt-5-mini"),
  ),
};
