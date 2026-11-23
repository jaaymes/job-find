import { describe, expect, it } from "vitest";
import { AiError } from "@/lib/client/ai/errors";
import { hasUsableProvider, resolveTaskModel } from "@/lib/client/ai/model";
import { defaultAiSettings, type AiSettings } from "@/lib/client/ai/settings";

const at = "2026-11-23T00:00:00.000Z";

describe("resolveTaskModel", () => {
  it("lança no_provider sem provedor conectado", async () => {
    const err = await resolveTaskModel(defaultAiSettings(), "cv").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err).toMatchObject({ code: "no_provider", retryable: false });
  });

  it("lança no_provider quando a tarefa aponta para provedor sem chave", async () => {
    const s: AiSettings = {
      ...defaultAiSettings(),
      tasks: { extract: null, analyze: { provider: "openai", model: "gpt-5-mini" }, cv: null },
    };
    await expect(resolveTaskModel(s, "analyze")).rejects.toMatchObject({ code: "no_provider" });
  });

  it("usa o provedor e modelo configurados na tarefa", async () => {
    const s: AiSettings = {
      ...defaultAiSettings(),
      providers: { openai: { key: "sk-test", addedAt: at, source: "paste" } },
      tasks: { extract: null, analyze: { provider: "openai", model: "gpt-5-mini" }, cv: null },
    };
    const r = await resolveTaskModel(s, "analyze");
    expect(r.provider.id).toBe("openai");
    expect(r.modelId).toBe("gpt-5-mini");
    expect(r.model).toBeTruthy();
  });

  it("sem configuração da tarefa, cai no primeiro provedor conectado com o modelo padrão", async () => {
    const s: AiSettings = {
      ...defaultAiSettings(),
      providers: { openrouter: { key: "sk-or", addedAt: at, source: "pkce" } },
    };
    const r = await resolveTaskModel(s, "analyze");
    expect(r.provider.id).toBe("openrouter");
    expect(r.modelId).toBe("deepseek/deepseek-v4.1-flash");
  });

  it("provedor local conta como conectado com baseURL (sem chave)", async () => {
    const s: AiSettings = {
      ...defaultAiSettings(),
      providers: { local: { baseURL: "http://127.0.0.1:11434/v1", addedAt: at, source: "paste" } },
    };
    const r = await resolveTaskModel(s, "extract");
    expect(r.provider.id).toBe("local");
  });

  it("fallback pula provedor com aviso de privacidade não aceito", async () => {
    const s: AiSettings = {
      ...defaultAiSettings(),
      providers: {
        deepseek: { key: "k", addedAt: at, source: "paste" },
        openai: { key: "k", addedAt: at, source: "paste" },
      },
    };
    expect((await resolveTaskModel(s, "extract")).provider.id).toBe("openai");
    s.providers.deepseek = { key: "k", addedAt: at, source: "paste", privacyAccepted: true };
    s.providers.openai = undefined;
    expect((await resolveTaskModel(s, "extract")).provider.id).toBe("deepseek");
  });

  it("escolha explícita de provedor com aviso não aceito lança blocked_by_privacy", async () => {
    const s: AiSettings = {
      ...defaultAiSettings(),
      providers: { deepseek: { key: "k", addedAt: at, source: "paste" } },
      tasks: { extract: { provider: "deepseek", model: "deepseek-chat" }, analyze: null, cv: null },
    };
    await expect(resolveTaskModel(s, "extract")).rejects.toMatchObject({ code: "blocked_by_privacy" });
  });
});

describe("hasUsableProvider", () => {
  const withKey = (extra: Partial<AiSettings> = {}): AiSettings => ({
    ...defaultAiSettings(),
    providers: { openai: { key: "sk-test", addedAt: at, source: "paste" } },
    ...extra,
  });

  it("false sem provedor; true com um conectado (automático)", () => {
    expect(hasUsableProvider(defaultAiSettings(), "analyze")).toBe(false);
    expect(hasUsableProvider(withKey(), "analyze")).toBe(true);
  });

  it("com escolha explícita, exige o provedor escolhido conectado", () => {
    const s = withKey({ tasks: { extract: null, analyze: { provider: "anthropic", model: "m" }, cv: null } });
    expect(hasUsableProvider(s, "analyze")).toBe(false);
    expect(hasUsableProvider(s, "extract")).toBe(true);
    const ok = withKey({ tasks: { extract: null, analyze: { provider: "openai", model: "m" }, cv: null } });
    expect(hasUsableProvider(ok, "analyze")).toBe(true);
  });

  it("provedor com aviso de privacidade não aceito não conta", () => {
    const s: AiSettings = {
      ...defaultAiSettings(),
      providers: { deepseek: { key: "k", addedAt: at, source: "paste" } },
    };
    expect(hasUsableProvider(s, "extract")).toBe(false);
    const accepted: AiSettings = {
      ...s,
      providers: { deepseek: { key: "k", addedAt: at, source: "paste", privacyAccepted: true } },
    };
    expect(hasUsableProvider(accepted, "extract")).toBe(true);
  });
});
