import "client-only";

import { Output, parsePartialJson, streamText } from "ai";
import { jsonrepair } from "jsonrepair";
import { z } from "@/lib/shared/zod";
import { AiError, isAbortError, mapProviderError } from "./errors";
import { resolveTaskModel } from "./model";
import type { AiTask, ProviderDef, ProviderId } from "./providers";
import type { AiSettings } from "./settings";

/** No máximo 2 chamadas ao modelo por operação, somando a retentativa do Zod e a do `validate`. */
const MAX_CALLS = 2;
const PARTIAL_INTERVAL_MS = 50;

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
  validate?: (v: T) => string[];
  /** Ponto de injeção para testes; o padrão é `resolveTaskModel`. */
  resolveModel?: ResolveModel;
};

function providerOptions(def: ProviderDef, settings: AiSettings) {
  if (def.id !== "openrouter") return undefined;
  return {
    openrouter: {
      provider: {
        require_parameters: true,
        ...(settings.dataCollectionDeny ? { data_collection: "deny" as const } : {}),
      },
      reasoning: { effort: "low" as const },
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
): Promise<string> {
  const providerId: ProviderId = model.provider.id;
  let streamError: { error: unknown } | undefined;
  const result = streamText({
    model: model.model,
    system,
    prompt,
    output: Output.object({ schema: a.schema }),
    maxOutputTokens: a.maxOutputTokens,
    temperature: a.temperature,
    abortSignal: a.signal,
    maxRetries: 0,
    providerOptions: providerOptions(model.provider, a.settings),
    // Sem isso o SDK imprime o erro no console; nós o tratamos abaixo.
    onError: () => {},
  });

  let acc = "";
  let lastPartial = "";
  let lastParseAt = 0;
  let finishReason: string | undefined;
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
  return acc;
}

/**
 * Geração estruturada: `streamText` + `Output.object`, validação Zod e `validate` (RN-07) com no máximo 2 chamadas.
 * Erros viram `AiError`; aborto do usuário é repassado como `AbortError`. A saída é sempre dado (texto), nunca HTML.
 */
export async function generateStructured<T>(
  a: GenerateArgs<T>,
): Promise<{ data: T; provider: ProviderId; model: string }> {
  const resolved = await (a.resolveModel ?? resolveTaskModel)(a.settings, a.task);
  const system =
    resolved.provider.structured !== "json_schema"
      ? `${a.system}\n\nResponda somente com JSON válido que siga este JSON Schema, sem texto extra:\n${JSON.stringify(z.toJSONSchema(a.schema))}`
      : a.system;

  let prompt = a.prompt;
  let problems: { issues?: string[]; violations?: string[] } = {};
  for (let call = 1; call <= MAX_CALLS; call++) {
    const raw = await callOnce(a, resolved, system, prompt);
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
        const violations = a.validate?.(checked.data) ?? [];
        if (violations.length === 0) {
          return { data: checked.data, provider: resolved.provider.id, model: resolved.modelId };
        }
        problems = { violations };
        feedback = violations;
      }
    }
    prompt = `${a.prompt}\n\nSua resposta anterior foi rejeitada pelos motivos abaixo. Corrija e responda de novo apenas com o JSON:\n${feedback.map((f) => `- ${f}`).join("\n")}`;
  }
  throw new AiError("invalid_output", { meta: problems });
}
