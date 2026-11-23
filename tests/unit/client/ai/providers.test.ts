import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_CSP_HOSTS } from "@/lib/shared/ai-hosts";
import { PROVIDERS, PROVIDER_IDS } from "@/lib/client/ai/providers";
import { AiSettings, defaultAiSettings } from "@/lib/client/ai/settings";

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

  it("OpenRouter usa PKCE e o modelo padrão da D-11", () => {
    expect(PROVIDERS.openrouter.auth).toBe("pkce");
    expect(PROVIDERS.openrouter.defaultModels.analyze).toBe("deepseek/deepseek-v4.1-flash");
  });

  it("Anthropic exige o header de acesso direto; local é configurado pelo usuário", () => {
    expect(PROVIDERS.anthropic.cors).toBe("needs-header");
    expect(PROVIDERS.local.cors).toBe("local-config");
    expect(PROVIDERS.local.auth).toBe("none");
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
  afterEach(() => vi.unstubAllGlobals());

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
    expect(url).toBe("https://openrouter.ai/api/v1/models");
    expect(url).not.toContain("sk-or-x");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-or-x");
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
});

describe("AiSettings", () => {
  it("rejeita provedor local fora de loopback", () => {
    expect(AiSettings.safeParse(withLocal("https://evil.com")).success).toBe(false);
    expect(AiSettings.safeParse(withLocal("http://evil.com:11434/v1")).success).toBe(false);
    expect(AiSettings.safeParse(withLocal("http://127.0.0.1.evil.com:11434")).success).toBe(false);
  });

  it("aceita loopback em 127.0.0.1, localhost e [::1]", () => {
    for (const u of ["http://127.0.0.1:11434/v1", "http://localhost:1234/v1", "http://[::1]:11434/v1"]) {
      expect(AiSettings.safeParse(withLocal(u)).success).toBe(true);
    }
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
    expect(d.minimizePii).toBe(true);
  });
});
