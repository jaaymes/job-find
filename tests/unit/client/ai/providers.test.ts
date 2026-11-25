import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_CSP_HOSTS } from "@/lib/shared/ai-hosts";
import { isFreeModel, isTextModelId, PROVIDERS, PROVIDER_IDS } from "@/lib/client/ai/providers";
import { AiSettings, defaultAiSettings } from "@/lib/client/ai/settings";

afterEach(() => vi.unstubAllGlobals());

const OPENROUTER_TEXT_URL =
  "https://openrouter.ai/api/v1/models?output_modalities=text&endpoints=/api/v1/chat/completions";

const withLocal = (baseURL: string) => ({
  ...defaultAiSettings(),
  providers: { local: { baseURL, addedAt: "2026-11-23T00:00:00.000Z", source: "paste" as const } },
});

describe("registro de provedores", () => {
  it("os provedores Must são exatamente os seis da D-17", () => {
    expect(
      Object.values(PROVIDERS)
        .filter((p) => p.tier === "must")
        .map((p) => p.id)
        .sort(),
    ).toEqual(["anthropic", "deepseek", "google", "local", "openai", "openrouter"]);
  });

  it("cobre os 14 provedores e cada entrada tem o próprio id", () => {
    expect(PROVIDER_IDS).toHaveLength(14);
    for (const id of PROVIDER_IDS) expect(PROVIDERS[id].id).toBe(id);
  });

  it("OpenRouter usa OAuth e o Free Models Router como padrão", () => {
    expect(PROVIDERS.openrouter.auth.kind).toBe("oauth");
    expect(PROVIDERS.openrouter.defaultModels.analyze).toBe("openrouter/free");
  });

  it("isFreeModel reconhece o roteador grátis e as variantes :free", () => {
    expect(isFreeModel("openrouter/free")).toBe(true);
    expect(isFreeModel("google/gemma-4-31b-it:free")).toBe(true);
    expect(isFreeModel("deepseek/deepseek-v4.1-flash")).toBe(false);
  });

  it("auth: só OpenRouter usa oauth; local não tem auth", () => {
    const kinds = Object.fromEntries(PROVIDER_IDS.map((id) => [id, PROVIDERS[id].auth.kind]));
    expect(kinds.openrouter).toBe("oauth");
    expect(kinds.local).toBe("none");
    expect(PROVIDER_IDS.filter((id) => kinds[id] === "paste")).not.toContain("openrouter");
  });

  it("Anthropic exige o header de acesso direto; local é configurado pelo usuário", () => {
    expect(PROVIDERS.anthropic.cors).toBe("needs-header");
    expect(PROVIDERS.local.cors).toBe("local-config");
    expect(PROVIDERS.local.auth.kind).toBe("none");
    expect(PROVIDERS.local.editableBaseURL).toBe(true);
  });

  it("a CSP cobre exatamente os hosts do registro", () => {
    expect(new Set(Object.values(PROVIDERS).flatMap((p) => p.cspHosts))).toEqual(
      new Set(AI_CSP_HOSTS),
    );
  });

  it("create carrega o SDK sob demanda e devolve um provedor com languageModel", async () => {
    const p = await PROVIDERS.openai.create({ apiKey: "sk-test" });
    expect(typeof p.languageModel).toBe("function");
    const a = await PROVIDERS.anthropic.create({ apiKey: "sk-ant-test" });
    expect(a.languageModel("claude-haiku-4-5")).toBeTruthy();
    const l = await PROVIDERS.local.create({ baseURL: "http://127.0.0.1:11434/v1" });
    expect(l.languageModel("llama3.2")).toBeTruthy();
  });

  it("Anthropic envia o header de acesso direto do navegador", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await PROVIDERS.anthropic.listModels({ apiKey: "sk-ant-test" });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = call[1].headers as Record<string, string>;
    expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    expect(call[0]).not.toContain("sk-ant-test");
  });

  it("local usa fetch com targetAddressSpace loopback", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const p = await PROVIDERS.local.create({ baseURL: "http://127.0.0.1:11434/v1" });
    const model = p.languageModel("llama3.2");
    try {
      await model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "oi" }] }] });
    } catch {
      // a resposta mockada é inválida de propósito; só interessa a opção do fetch
    }
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit & Record<string, unknown>])[1];
    expect(init.targetAddressSpace).toBe("loopback");
  });
});

describe("listModels (fetch mockado)", () => {
  it("OpenRouter devolve preços por milhão de tokens e a chave vai no header", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", pricing: { prompt: "0.0000002", completion: "0.0000008" } },
            ],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const models = await PROVIDERS.openrouter.listModels({ apiKey: "sk-or-x" });
    expect(models).toEqual([
      { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", priceIn: 0.2, priceOut: 0.8 },
    ]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(OPENROUTER_TEXT_URL);
    expect(url).not.toContain("sk-or-x");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-x");
  });

  it("OpenRouter pede só modelos de texto servidos por chat/completions", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await PROVIDERS.openrouter.listModels({ apiKey: "k" });
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toBe(OPENROUTER_TEXT_URL);
  });

  it("OpenRouter: resposta vazia com os filtros cai para a lista sem filtros, sem as variantes :batch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: "a/x" }, { id: "a/x:batch" }] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const models = await PROVIDERS.openrouter.listModels({ apiKey: "k" });
    expect(models.map((m) => m.id)).toEqual(["a/x"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://openrouter.ai/api/v1/models");
  });

  it("OpenRouter: se a lista sem filtros também vier vazia, devolve []", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await PROVIDERS.openrouter.listModels({ apiKey: "k" })).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    "text-embedding-3-small", "whisper-1", "tts-1-hd", "gpt-4o-transcribe", "dall-e-3", "gpt-image-1",
    "omni-moderation-latest", "gpt-4o-audio-preview", "gpt-4o-realtime-preview", "llama-guard-4", "rerank-v3",
    "mistral-embed",
  ])("isTextModelId(%s) é false", (id) => expect(isTextModelId(id)).toBe(false));

  it.each([
    "gpt-5-mini", "llama-3.3-70b-versatile", "mistral-large-latest", "grok-4", "deepseek-chat",
    "gpt-4o", "o3", "gemini-2.5-flash", "qwen3-coder",
  ])(
    "isTextModelId(%s) é true",
    (id) => expect(isTextModelId(id)).toBe(true),
  );

  it("listOpenAIStyle descarta modelos que não são de chat", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "gpt-5-mini" }, { id: "whisper-1" }] }), { status: 200 })),
    );
    const models = await PROVIDERS.openai.listModels({ apiKey: "k" });
    expect(models.map((m) => m.id)).toEqual(["gpt-5-mini"]);
  });

  it("Google lista modelos sem a chave na URL", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ models: [{ name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash" }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const models = await PROVIDERS.google.listModels({ apiKey: "g-key" });
    expect(models).toEqual([{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("g-key");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("g-key");
  });

  it("401 vira AiError invalid_key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    await expect(PROVIDERS.openai.listModels({ apiKey: "bad" })).rejects.toMatchObject({ code: "invalid_key" });
  });

  it("402 vira AiError no_credit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 402 })));
    await expect(PROVIDERS.openai.listModels({ apiKey: "k" })).rejects.toMatchObject({ code: "no_credit" });
  });
});

describe("AiSettings", () => {
  it("rejeita provedor local fora de loopback", () => {
    expect(AiSettings.safeParse(withLocal("https://evil.com")).success).toBe(false);
    expect(AiSettings.safeParse(withLocal("http://evil.com:11434/v1")).success).toBe(false);
    expect(AiSettings.safeParse(withLocal("http://127.0.0.1.evil.com:11434")).success).toBe(false);
  });

  it("aceita loopback em 127.0.0.1 e localhost; rejeita [::1] (fora da CSP)", () => {
    for (const u of ["http://127.0.0.1:11434/v1", "http://localhost:1234/v1"]) {
      expect(AiSettings.safeParse(withLocal(u)).success).toBe(true);
    }
    expect(AiSettings.safeParse(withLocal("http://[::1]:11434/v1")).success).toBe(false);
  });

  it("DeepSeek e Gemini têm aviso de privacidade", () => {
    expect(PROVIDERS.deepseek.privacyNote).toMatch(/China/);
    expect(PROVIDERS.google.privacyNote).toBeTruthy();
  });

  it("listModels local com resposta não-JSON vira AiError unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    await expect(
      PROVIDERS.local.listModels({ baseURL: "http://127.0.0.1:11434/v1" }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("não permite baseURL personalizada em provedores de nuvem", () => {
    const s = {
      ...defaultAiSettings(),
      providers: { openai: { key: "k", baseURL: "https://evil.com/v1", addedAt: "x", source: "paste" as const } },
    };
    expect(AiSettings.safeParse(s).success).toBe(false);
  });

  it("padrões: privacidade ligada e nenhuma tarefa configurada", () => {
    const d = AiSettings.parse({ providers: {}, tasks: { extract: null, analyze: null, cv: null } });
    expect(d.dataCollectionDeny).toBe(true);
    expect(d.minimizePii).toBeUndefined();
    expect(AiSettings.safeParse({ ...d, minimizePii: false }).success).toBe(true);
  });
});
