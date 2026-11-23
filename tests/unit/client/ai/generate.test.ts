import { APICallError } from "@ai-sdk/provider";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiError, mapProviderError } from "@/lib/client/ai/errors";
import { generateStructured } from "@/lib/client/ai/generate";
import { PROVIDERS, type ProviderId } from "@/lib/client/ai/providers";
import { defaultAiSettings } from "@/lib/client/ai/settings";

type Chunk = Record<string, unknown>;
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const finish = (unified: string): Chunk => ({ type: "finish", usage, finishReason: { unified, raw: unified } });
const text = (...parts: string[]): Chunk[] => [
  { type: "text-start", id: "t" },
  ...parts.map((delta) => ({ type: "text-delta", id: "t", delta })),
  { type: "text-end", id: "t" },
];
const streamResult = (chunks: Chunk[]) => ({
  stream: simulateReadableStream({ chunks: [{ type: "stream-start", warnings: [] }, ...chunks] as never[] }),
});
const mockModel = (...results: Chunk[][]) =>
  new MockLanguageModelV4({ doStream: results.map(streamResult) as never });

const Schema = z.object({ name: z.string(), years: z.number() });
const ok = JSON.stringify({ name: "Ana", years: 3 });

function run(
  model: MockLanguageModelV4,
  over: Partial<Parameters<typeof generateStructured<z.infer<typeof Schema>>>[0]> = {},
  provider: ProviderId = "openai",
) {
  return generateStructured({
    task: "extract",
    settings: defaultAiSettings(),
    system: "sys",
    prompt: "prompt",
    schema: Schema,
    maxOutputTokens: 500,
    temperature: 0,
    resolveModel: async () => ({ model, provider: PROVIDERS[provider], modelId: "m1" }),
    ...over,
  });
}

describe("generateStructured", () => {
  it("devolve dados válidos, provedor e modelo, e chama onPartial", async () => {
    const model = mockModel([...text(ok.slice(0, 10), ok.slice(10)), finish("stop")]);
    const onPartial = vi.fn();
    const r = await run(model, { onPartial });
    expect(r).toEqual({ data: { name: "Ana", years: 3 }, provider: "openai", model: "m1" });
    expect(model.doStreamCalls).toHaveLength(1);
    expect(onPartial).toHaveBeenCalled();
  });

  it("onPartial que lança não derruba o stream", async () => {
    const model = mockModel([...text(ok.slice(0, 10), ok.slice(10)), finish("stop")]);
    const r = await run(model, {
      onPartial: () => {
        throw new Error("boom");
      },
    });
    expect(r.data.name).toBe("Ana");
  });

  it("JSON inválido: 2ª chamada com os erros do Zod, no máximo 2 chamadas", async () => {
    const model = mockModel(
      [...text('{"name": 1}'), finish("stop")],
      [...text(ok), finish("stop")],
    );
    const r = await run(model);
    expect(r.data.years).toBe(3);
    expect(model.doStreamCalls).toHaveLength(2);
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("years");
  });

  it("usa jsonrepair antes de declarar invalid_output (sem 2ª chamada)", async () => {
    const model = mockModel([...text("```json\n{name: 'Ana', years: 3,}\n```"), finish("stop")]);
    const r = await run(model);
    expect(r.data).toEqual({ name: "Ana", years: 3 });
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("validate com violações nas duas tentativas: invalid_output com meta.violations após 2 chamadas", async () => {
    const model = mockModel([...text(ok), finish("stop")], [...text(ok), finish("stop")]);
    const err = await run(model, { validate: () => ["anos inventados"] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err).toMatchObject({ code: "invalid_output", meta: { violations: ["anos inventados"] } });
    expect(model.doStreamCalls).toHaveLength(2);
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("anos inventados");
  });

  it("Zod falho + validate falho somam no máximo 2 chamadas", async () => {
    const model = mockModel([...text("{}"), finish("stop")], [...text(ok), finish("stop")]);
    const err = await run(model, { validate: () => ["x"] }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "invalid_output" });
    expect(model.doStreamCalls).toHaveLength(2);
  });

  it("erro no meio do stream (HTTP 200) vira unavailable retryable", async () => {
    const model = mockModel([
      ...text(ok.slice(0, 8)),
      { type: "error", error: { message: "upstream died" } },
      finish("error"),
    ]);
    const err = await run(model).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "unavailable", retryable: true });
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("finish_reason length vira truncated", async () => {
    const model = mockModel([...text(ok.slice(0, 12)), finish("length")]);
    await expect(run(model)).rejects.toMatchObject({ code: "truncated" });
  });

  it("erro HTTP do provedor é mapeado (402 -> no_credit)", async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw new APICallError({ message: "x", url: "u", requestBodyValues: {}, statusCode: 402 });
      },
    });
    await expect(run(model)).rejects.toMatchObject({ code: "no_credit" });
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("aborto é repassado, não vira AiError", async () => {
    const ac = new AbortController();
    ac.abort();
    const model = mockModel([...text(ok), finish("stop")]);
    const err = await run(model, { signal: ac.signal }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AiError);
  });

  it("OpenRouter envia require_parameters e data_collection deny", async () => {
    const model = mockModel([...text(ok), finish("stop")]);
    await run(model, { settings: { ...defaultAiSettings(), dataCollectionDeny: true } }, "openrouter");
    const opts = model.doStreamCalls[0]?.providerOptions as { openrouter?: { provider?: unknown } };
    expect(opts.openrouter?.provider).toMatchObject({ require_parameters: true, data_collection: "deny" });
  });

  it("OpenRouter sem dataCollectionDeny não envia data_collection", async () => {
    const model = mockModel([...text(ok), finish("stop")]);
    await run(model, { settings: { ...defaultAiSettings(), dataCollectionDeny: false } }, "openrouter");
    const opts = model.doStreamCalls[0]?.providerOptions as { openrouter?: { provider?: Record<string, unknown> } };
    expect(opts.openrouter?.provider).not.toHaveProperty("data_collection");
  });

  it("json_mode coloca o schema em texto no system prompt", async () => {
    const model = mockModel([...text(ok), finish("stop")]);
    await run(model, {}, "deepseek");
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain("years");
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain("JSON Schema");
  });

  it("json_schema não duplica o schema no system prompt", async () => {
    const model = mockModel([...text(ok), finish("stop")]);
    await run(model);
    expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).not.toContain("JSON Schema");
  });

  it("padrão usa resolveTaskModel: sem provedor lança no_provider", async () => {
    await expect(
      generateStructured({
        task: "extract",
        settings: defaultAiSettings(),
        system: "s",
        prompt: "p",
        schema: Schema,
        maxOutputTokens: 10,
        temperature: 0,
      }),
    ).rejects.toMatchObject({ code: "no_provider" });
  });
});

describe("mapProviderError", () => {
  const api = (statusCode: number, extra: { data?: unknown; responseBody?: string } = {}) =>
    new APICallError({ message: "x", url: "u", requestBodyValues: {}, statusCode, ...extra });

  it.each([
    [401, "invalid_key", false],
    [402, "no_credit", false],
    [429, "rate_limit", true],
    [408, "timeout", true],
    [502, "unavailable", true],
    [500, "unavailable", true],
  ])("%i -> %s", (status, code, retryable) => {
    expect(mapProviderError(api(status))).toMatchObject({ code, retryable });
  });

  it("403 com limit_usd -> budget", () => {
    const e = mapProviderError(api(403, { data: { error: { metadata: { limit_usd: 5 } } } }));
    expect(e.code).toBe("budget");
    expect(mapProviderError(api(403, { responseBody: '{"error":{"metadata":{"limit_usd":5}}}' })).code).toBe("budget");
  });

  it("503 do OpenRouter com data_collection -> blocked_by_privacy", () => {
    const e = mapProviderError(api(503, { responseBody: "no endpoints: data_collection deny" }));
    expect(e).toMatchObject({ code: "blocked_by_privacy", retryable: false });
  });

  it("erro sem status (corpo com HTTP 200) -> unavailable retryable", () => {
    expect(mapProviderError({ message: "provider error" })).toMatchObject({ code: "unavailable", retryable: true });
    expect(mapProviderError(api(200))).toMatchObject({ code: "unavailable", retryable: true });
  });

  it("falha de rede: TypeError -> unavailable; local -> local_blocked", () => {
    const e = new TypeError("Failed to fetch");
    expect(mapProviderError(e)).toMatchObject({ code: "unavailable", retryable: true });
    expect(mapProviderError(e, { provider: "local" })).toMatchObject({ code: "local_blocked" });
  });

  it("não reembrulha AiError", () => {
    const e = new AiError("budget");
    expect(mapProviderError(e)).toBe(e);
  });
});
