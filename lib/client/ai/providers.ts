import "client-only";

import type { ProviderV4 } from "@ai-sdk/provider";
import { z } from "@/lib/shared/zod";
import { AiError } from "./errors";
import { openRouterFlow } from "./oauth/openrouter";

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

export type OAuthTokens = { key: string; refreshToken?: string; expiresAt?: string };

export type OAuthFlow = {
  authorizeUrl(p: { redirectUri: string; challenge: string; state: string; origin: string }): string;
  exchange(p: { code: string; verifier: string; redirectUri: string; origin: string }): Promise<OAuthTokens>;
  refresh?(p: { refreshToken: string; origin: string }): Promise<OAuthTokens>;
  /**
   * O provedor pode não devolver o `state` no retorno (não documenta). Se vier, ainda tem que bater; se faltar, o PKCE
   * com verifier por sessão já impede login-CSRF (RFC 9700 §2.1.1).
   */
  stateOptional?: boolean;
};

export type AuthDef =
  | { kind: "oauth"; flow: OAuthFlow; pasteFallback?: boolean }
  | { kind: "paste" }
  | { kind: "none" };

export type KeyHint = { prefix: string; example: string };

export type ProviderDef = {
  id: ProviderId;
  label: string;
  tier: "must" | "should";
  baseURL: string;
  editableBaseURL: boolean;
  cors: "yes" | "needs-header" | "local-config";
  structured: "json_schema" | "tool" | "json_mode";
  auth: AuthDef;
  keyDocsUrl: string;
  keyHint?: KeyHint;
  keySteps?: string[];
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
  if (res.status === 402) throw new AiError("no_credit", { meta: { status: 402 } });
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

/** Preço já em USD por milhão (número ou texto) -> número válido, senão undefined. */
function asPrice(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const TogetherEntry = z.looseObject({ id: z.string(), display_name: z.string().optional() });
const PricingLoose = z.looseObject({ input: z.unknown().optional(), output: z.unknown().optional() });
const VercelEntry = z.looseObject({
  id: z.string(),
  name: z.string().optional(),
  pricing: z.unknown().optional(),
});

function pricingOf(e: unknown): z.infer<typeof PricingLoose> | undefined {
  const p = PricingLoose.safeParse((e as { pricing?: unknown } | null)?.pricing);
  return p.success ? p.data : undefined;
}

/** Together: `GET /v1/models` devolve um array na raiz (aceita também `{ data: [...] }`); pricing em USD por 1M. */
async function listTogether(cfg: ProviderCfg): Promise<ModelInfo[]> {
  const json = await getJson(`${cfg.baseURL ?? "https://api.together.xyz/v1"}/models`, bearer(cfg));
  const list = Array.isArray(json) ? json : OpenAIList.safeParse(json).data?.data;
  if (!list) return [];
  return list.flatMap((e): ModelInfo[] => {
    const m = TogetherEntry.safeParse(e);
    if (!m.success) return [];
    const p = pricingOf(e);
    return [
      {
        id: m.data.id,
        label: m.data.display_name ?? m.data.id,
        priceIn: asPrice(p?.input),
        priceOut: asPrice(p?.output),
      },
    ];
  });
}

/** Vercel AI Gateway: `data[].pricing.input/output` em USD por token (texto). */
async function listVercelGateway(cfg: ProviderCfg): Promise<ModelInfo[]> {
  const body = OpenAIList.safeParse(
    await getJson(`${cfg.baseURL ?? "https://ai-gateway.vercel.sh/v1"}/models`, bearer(cfg)),
  );
  if (!body.success) return [];
  return body.data.data.flatMap((e): ModelInfo[] => {
    const m = VercelEntry.safeParse(e);
    if (!m.success) return [];
    const p = pricingOf(e);
    const perTok = (v: unknown) => (typeof v === "string" ? perMillion(v) : undefined);
    return [
      { id: m.data.id, label: m.data.name ?? m.data.id, priceIn: perTok(p?.input), priceOut: perTok(p?.output) },
    ];
  });
}

const NON_CHAT_MODEL = /(embed|whisper|tts|transcribe|dall-e|gpt-image|moderation|rerank|-audio|realtime|guard)/i;

/** Modelo de texto/chat: descarta embeddings, voz, imagem, moderação, rerank e afins. */
export function isTextModelId(id: string): boolean {
  return !NON_CHAT_MODEL.test(id);
}

function listOpenAIStyle(baseURL: string) {
  return async (cfg: ProviderCfg): Promise<ModelInfo[]> => {
    const body = OpenAIList.safeParse(await getJson(`${cfg.baseURL ?? baseURL}/models`, bearer(cfg)));
    if (!body.success) return [];
    return body.data.data.flatMap((e) => {
      const m = Entry.safeParse(e);
      return m.success && isTextModelId(m.data.id) ? [{ id: m.data.id, label: m.data.id }] : [];
    });
  };
}

async function listOpenRouter(cfg: ProviderCfg): Promise<ModelInfo[]> {
  const parse = (json: unknown, dropBatch: boolean): ModelInfo[] => {
    const body = OpenAIList.safeParse(json);
    if (!body.success) return [];
    return body.data.data.flatMap((e) => {
      const m = OpenRouterEntry.safeParse(e);
      if (!m.success || (dropBatch && m.data.id.endsWith(":batch"))) return [];
      return [
        {
          id: m.data.id,
          label: m.data.name ?? m.data.id,
          priceIn: perMillion(m.data.pricing?.prompt),
          priceOut: perMillion(m.data.pricing?.completion),
        },
      ];
    });
  };
  const url = `${PROVIDERS_BASE.openrouter}/models`;
  const filtered = parse(
    await getJson(`${url}?output_modalities=text&endpoints=/api/v1/chat/completions`, bearer(cfg)),
    false,
  );
  if (filtered.length > 0) return filtered;
  // Os filtros podem não ser aceitos: uma única repetição sem query, sem as variantes :batch.
  return parse(await getJson(url, bearer(cfg)), true);
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

/** "Free Models Router" do OpenRouter: escolhe um modelo gratuito que atende o pedido (inclusive saída estruturada) e nunca cobra. */
export const OPENROUTER_FREE_MODEL = "openrouter/free";

/** Aviso que a pessoa aceita antes de usar os modelos gratuitos do OpenRouter (padrão do Job Find). */
export const FREE_MODELS_NOTE =
  "Os modelos gratuitos do OpenRouter não custam nada, mas têm limite de uso por dia, e quem os oferece pode guardar o texto enviado, usá-lo para treinar modelos ou publicá-lo. O Job Find nunca envia seu e-mail, telefone, endereço nem seu nome. Para mais privacidade, escolha um modelo pago ou a IA local. Se os pedidos falharem, libere os modelos gratuitos em openrouter.ai/settings/privacy.";

/** Modelo gratuito do OpenRouter: o roteador grátis ou uma variante `:free`. */
export function isFreeModel(modelId: string): boolean {
  return modelId === OPENROUTER_FREE_MODEL || modelId.endsWith(":free");
}

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
  privacyNote: string | null = null,
  listModels: ProviderDef["listModels"] = listOpenAIStyle(baseURL),
): ProviderDef {
  return {
    id,
    label,
    tier,
    baseURL,
    editableBaseURL: false,
    cors: "yes",
    structured,
    auth: { kind: "paste" },
    keyDocsUrl,
    privacyNote,
    cspHosts: [host],
    defaultModels: models,
    create: openAICompatible(id, baseURL),
    listModels,
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
    auth: { kind: "oauth", flow: openRouterFlow },
    keyDocsUrl: "https://openrouter.ai/docs/guides/overview/auth/oauth",
    privacyNote: null,
    cspHosts: ["https://openrouter.ai"],
    // Padrão gratuito: quem conecta o OpenRouter já usa IA sem gastar. Modelos pagos continuam na lista.
    defaultModels: same(OPENROUTER_FREE_MODEL),
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
    auth: { kind: "paste" },
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
    auth: { kind: "paste" },
    keyDocsUrl: "https://console.anthropic.com/settings/keys",
    privacyNote: null,
    cspHosts: ["https://api.anthropic.com"],
    defaultModels: { extract: "claude-haiku-5-5", analyze: "claude-haiku-5-5", cv: "claude-sonnet-5-5" },
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
    auth: { kind: "paste" },
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
    "json_mode",
    "A API direta da DeepSeek processa os dados em servidores na China. Confirme que aceita enviar seu currículo e as vagas para lá antes do primeiro uso.",
  ),
  local: {
    id: "local",
    label: "IA local (Ollama / LM Studio) - experimental",
    tier: "must",
    baseURL: "http://127.0.0.1:11434/v1",
    editableBaseURL: true,
    cors: "local-config",
    structured: "json_mode",
    auth: { kind: "none" },
    keyDocsUrl: "https://github.com/ollama/ollama/blob/main/docs/faq.md",
    privacyNote: null,
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
      let json: unknown;
      try {
        json = await res.json();
      } catch (cause) {
        throw new AiError("unavailable", { retryable: true, cause });
      }
      const body = OpenAIList.safeParse(json);
      if (!body.success) return [];
      return body.data.data.flatMap((e) => {
        const m = Entry.safeParse(e);
        return m.success ? [{ id: m.data.id, label: m.data.id, priceIn: 0, priceOut: 0 }] : [];
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
    auth: { kind: "paste" },
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
    "json_mode",
    null,
    listTogether,
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
    "json_mode",
    null,
    listVercelGateway,
  ),
};
