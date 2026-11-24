import "client-only";

import type { SharedV4ProviderOptions } from "@ai-sdk/provider";
import { Output, parsePartialJson, streamText } from "ai";
import { jsonrepair } from "jsonrepair";
import { z } from "@/lib/shared/zod";
import { AiError, isAbortError, mapProviderError } from "./errors";
import { resolveTaskModel } from "./model";
import { isFreeModel, type AiTask, type ProviderDef, type ProviderId } from "./providers";
import type { AiSettings } from "./settings";

/** No máximo 2 chamadas ao modelo por operação, somando a retentativa do Zod e a do `validate`. */
const MAX_CALLS = 2;
const PARTIAL_INTERVAL_MS = 50;

/** Tokens consumidos (somados nas chamadas); `undefined` quando o provedor não informa. */
export type TokenUsage = { inputTokens?: number; outputTokens?: number };

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  const sum = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0));
  return { inputTokens: sum(a.inputTokens, b.inputTokens), outputTokens: sum(a.outputTokens, b.outputTokens) };
}

type ResolveModel = (s: AiSettings, task: AiTask) => ReturnType<typeof resolveTaskModel>;

export type GenerateArgs<T> = {
  task: AiTask;
  settings: AiSettings;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  temperature: number;
  signal?: AbortSignal;
  onPartial?: (p: unknown) => void;
  /** `ctx.last`: é a última chamada permitida (a resposta não terá outra chance de ser corrigida). */
  validate?: (v: T, ctx: { attempt: number; last: boolean }) => string[];
  /** Ponto de injeção para testes; o padrão é `resolveTaskModel`. */
  resolveModel?: ResolveModel;
};

/**
 * Na extração do currículo o raciocínio só come o orçamento de saída (finishReason "length"), então pedimos o mínimo.
 * OpenAI: "minimal" não vale nos modelos o-series, por isso "low". Google: 128 só vale no 2.5 Pro, no 2.5 Flash (não o Lite, que exige 512+) e na família 3;
 * Gemma e Gemini 2.0 não têm thinking, então nesses modelos não enviamos thinkingConfig.
 */
const GOOGLE_THINKING_128 = /^(models\/)?gemini-(2\.5-(pro|flash)(?!-lite)|3)/;

/**
 * No OpenRouter, todos os modelos gratuitos (e o roteador `openrouter/free`) raciocinam, e os tokens de raciocínio
 * contam no mesmo `max_tokens` da resposta. Alguns ignoram `effort: "low"`. Sem folga, o orçamento do JSON acaba no
 * raciocínio e a resposta volta cortada (`finish_reason: "length"`). Só é cobrado o que o modelo de fato usa.
 */
const OPENROUTER_REASONING_HEADROOM = 6000;

function outputBudget(def: ProviderDef, base: number): number {
  return def.id === "openrouter" ? base + OPENROUTER_REASONING_HEADROOM : base;
}

function providerOptions(def: ProviderDef, settings: AiSettings, task: AiTask, modelId: string): SharedV4ProviderOptions | undefined {
  if (def.id === "openai" && task === "extract") return { openai: { reasoningEffort: "low" as const } };
  if (def.id === "google") {
    if (task === "extract" && GOOGLE_THINKING_128.test(modelId)) {
      return { google: { thinkingConfig: { thinkingBudget: 128 } } };
    }
    return undefined;
  }
  if (def.id !== "openrouter") return undefined;
  return {
    openrouter: {
      provider: {
        require_parameters: true,
        // Modelos gratuitos quase sempre vêm de endpoints que guardam dados: com `deny` não sobra nenhum.
        // Só chegam aqui com o aviso dos gratuitos aceito (`freeConsent`, ver `resolveTaskModel`).
        ...(settings.dataCollectionDeny && !isFreeModel(modelId) ? { data_collection: "deny" as const } : {}),
      },
      // `exclude`: o raciocínio não vem no stream (não usamos e só pesaria no download).
      reasoning: { effort: "low" as const, exclude: true },
    },
  };
}

/** Tenta JSON.parse e, se falhar, `jsonrepair` (cercas de markdown, aspas simples, vírgula sobrando, corte). */
function parseLoose(raw: string): { ok: true; value: unknown } | { ok: false } {
  const t = raw.trim();
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    try {
      const unfenced = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      return { ok: true, value: JSON.parse(jsonrepair(unfenced)) };
    } catch {
      return { ok: false };
    }
  }
}

/** Motivo do aborto: `TimeoutError` (AbortSignal.timeout) vira `timeout`; o resto segue como AbortError. */
function abortReason(signal?: AbortSignal): unknown {
  const r: unknown = signal?.reason;
  if (typeof r === "object" && r !== null && (r as { name?: unknown }).name === "TimeoutError") {
    return new AiError("timeout", { retryable: true });
  }
  return new DOMException("Aborted", "AbortError");
}

/** Uma chamada ao modelo: devolve o texto completo ou lança AiError (nunca deixa rejeição solta). */
async function callOnce<T>(
  a: GenerateArgs<T>,
  model: Awaited<ReturnType<ResolveModel>>,
  system: string,
  prompt: string,
  maxOutputTokens: number,
): Promise<{ text: string; usage: TokenUsage }> {
  const providerId: ProviderId = model.provider.id;
  let streamError: { error: unknown } | undefined;
  const result = streamText({
    model: model.model,
    system,
    prompt,
    output: Output.object({ schema: a.schema }),
    maxOutputTokens,
    temperature: a.temperature,
    abortSignal: a.signal,
    maxRetries: 0,
    providerOptions: providerOptions(model.provider, a.settings, a.task, model.modelId),
    // Sem isso o SDK imprime o erro no console; nós o tratamos abaixo.
    onError: () => {},
  });

  let acc = "";
  let lastPartial = "";
  let lastParseAt = 0;
  let finishReason: string | undefined;
  let usage: TokenUsage = {};
  const emitPartial = async () => {
    const parsed = await parsePartialJson(acc).catch(() => undefined);
    const serialized = parsed && parsed.value !== undefined ? JSON.stringify(parsed.value) : "";
    if (!serialized || serialized === lastPartial) return;
    lastPartial = serialized;
    try {
      a.onPartial?.(parsed?.value);
    } catch {
      // onPartial nunca pode quebrar o stream.
    }
  };
  try {
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        acc += part.text;
        // Limita a 1 parse a cada 50 ms para não custar O(n²) em saídas grandes.
        const now = Date.now();
        if (a.onPartial && now - lastParseAt >= PARTIAL_INTERVAL_MS) {
          lastParseAt = now;
          await emitPartial();
        }
      } else if (part.type === "error") {
        streamError ??= { error: part.error };
      } else if (part.type === "finish") {
        finishReason = part.finishReason;
        usage = { inputTokens: part.totalUsage.inputTokens, outputTokens: part.totalUsage.outputTokens };
      } else if (part.type === "abort") {
        throw abortReason(a.signal);
      }
    }
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw mapProviderError(e, { provider: providerId });
  }
  if (a.signal?.aborted) throw abortReason(a.signal);
  // Último valor parcial: deltas dentro da janela do throttle ainda não foram emitidos.
  if (a.onPartial && !streamError) await emitPartial();
  if (streamError) throw mapProviderError(streamError.error, { provider: providerId });
  if (finishReason === "length") throw new AiError("truncated", { meta: { finishReason } });
  if (finishReason === "error" || finishReason === "interrupted" || finishReason === undefined) {
    throw new AiError("unavailable", { retryable: true, meta: { finishReason } });
  }
  return { text: acc, usage };
}

/**
 * Geração estruturada: `streamText` + `Output.object`, validação Zod e `validate` (RN-07) com no máximo 2 chamadas.
 * Erros viram `AiError`; aborto do usuário é repassado como `AbortError`. A saída é sempre dado (texto), nunca HTML.
 */
export async function generateStructured<T>(
  a: GenerateArgs<T>,
): Promise<{ data: T; provider: ProviderId; model: string; calls: number; usage: TokenUsage }> {
  const resolved = await (a.resolveModel ?? resolveTaskModel)(a.settings, a.task);
  const system =
    resolved.provider.structured !== "json_schema"
      ? `${a.system}\n\nResponda somente com JSON válido que siga este JSON Schema, sem texto extra:\n${JSON.stringify(z.toJSONSchema(a.schema))}`
      : a.system;

  let prompt = a.prompt;
  let usage: TokenUsage = {};
  let problems: { issues?: string[]; violations?: string[] } = {};
  let budget = outputBudget(resolved.provider, a.maxOutputTokens);
  for (let call = 1; call <= MAX_CALLS; call++) {
    let once: Awaited<ReturnType<typeof callOnce>>;
    try {
      once = await callOnce(a, resolved, system, prompt, budget);
    } catch (e) {
      // OpenRouter: o corte vem do raciocínio que passou da folga. Repete o mesmo pedido com o dobro do orçamento.
      const retryCut =
        e instanceof AiError && e.code === "truncated" && resolved.provider.id === "openrouter" && call < MAX_CALLS;
      if (!retryCut) throw e;
      budget *= 2;
      continue;
    }
    const raw = once.text;
    usage = addUsage(usage, once.usage);
    const parsed = parseLoose(raw);
    let feedback: string[];
    if (!parsed.ok) {
      problems = { issues: ["a resposta não é um JSON válido"] };
      feedback = problems.issues ?? [];
    } else {
      const checked = a.schema.safeParse(parsed.value);
      if (!checked.success) {
        const issues = checked.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`);
        problems = { issues };
        feedback = issues;
      } else {
        const violations = a.validate?.(checked.data, { attempt: call, last: call === MAX_CALLS }) ?? [];
        if (violations.length === 0) {
          return { data: checked.data, provider: resolved.provider.id, model: resolved.modelId, calls: call, usage };
        }
        problems = { violations };
        feedback = violations;
      }
    }
    prompt = `${a.prompt}\n\nSua resposta anterior foi rejeitada pelos motivos abaixo. Corrija e responda de novo apenas com o JSON:\n${feedback.map((f) => `- ${f}`).join("\n")}`;
  }
  throw new AiError("invalid_output", { meta: problems });
}
