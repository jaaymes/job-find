import { describe, expect, it } from "vitest";
import { checkKey } from "@/lib/client/ai/key-hint";
import { PROVIDER_IDS, PROVIDERS } from "@/lib/client/ai/providers";

const CLEAN = { warning: null, suggest: null };

describe("checkKey", () => {
  it("sk-ant- colada no OpenAI sugere anthropic", () => expect(checkKey("openai", "sk-ant-abc").suggest).toBe("anthropic"));

  it("sk-or- no OpenRouter não avisa", () => expect(checkKey("openrouter", "sk-or-v1-x")).toEqual(CLEAN));

  it("provedor sem keyHint nunca avisa", () => expect(checkKey("deepseek", "qualquer").warning).toBeNull());

  it("o aviso de sugestão cita o rótulo do provedor sugerido", () =>
    expect(checkKey("openai", "sk-ant-abc")).toEqual({
      warning: "Parece uma chave do(a) Anthropic (Claude).",
      suggest: "anthropic",
    }));

  it("sk-or- colada no OpenAI sugere o OpenRouter (o prefixo mais longo vence sk-)", () =>
    expect(checkKey("openai", "sk-or-v1-abc").suggest).toBe("openrouter"));

  it("sk-proj- no OpenAI não avisa", () => expect(checkKey("openai", "sk-proj-abc")).toEqual(CLEAN));

  it("chave da OpenAI colada no Anthropic sugere a OpenAI", () =>
    expect(checkKey("anthropic", "sk-proj-abc")).toEqual({ warning: "Parece uma chave do(a) OpenAI.", suggest: "openai" }));

  it("chave sem o prefixo do provedor e sem outro dono avisa sem sugerir", () =>
    expect(checkKey("anthropic", "abc123")).toEqual({
      warning: "Essa chave não parece ser do(a) Anthropic (Claude). Confira se copiou a chave certa.",
      suggest: null,
    }));

  it("campo vazio ou ainda digitando o prefixo não avisa", () => {
    expect(checkKey("anthropic", "")).toEqual(CLEAN);
    expect(checkKey("anthropic", "sk-a")).toEqual(CLEAN);
  });

  it("ignora espaços nas pontas", () => expect(checkKey("openrouter", "  sk-or-v1-x \n")).toEqual(CLEAN));

  it("o aviso nunca contém a chave", () => {
    for (const id of PROVIDER_IDS) {
      for (const key of ["sk-ant-segredo-9876", "segredo-9876"]) {
        expect(checkKey(id, key).warning ?? "").not.toContain("segredo");
      }
    }
  });

  it("keySteps tem no máximo 3 linhas e existe para OpenAI, Anthropic, Google e DeepSeek", () => {
    for (const id of ["openai", "anthropic", "google", "deepseek"] as const) {
      expect(PROVIDERS[id].keySteps?.length ?? 0).toBeGreaterThan(0);
    }
    for (const id of PROVIDER_IDS) expect(PROVIDERS[id].keySteps?.length ?? 0).toBeLessThanOrEqual(3);
  });

  it("o exemplo de cada keyHint começa com o próprio prefixo", () => {
    for (const id of PROVIDER_IDS) {
      const h = PROVIDERS[id].keyHint;
      if (h) expect(h.example.startsWith(h.prefix)).toBe(true);
    }
  });
});
