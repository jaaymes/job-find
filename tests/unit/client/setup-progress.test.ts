import { describe, expect, it } from "vitest";
import { defaultAiSettings, type AiSettings } from "@/lib/client/ai/settings";
import { getSetupProgress, safeReturnPath, withReturn } from "@/lib/client/setup/progress";
import { emptyProfile } from "@/lib/shared/schemas/profile";

const ai = { ...defaultAiSettings(), providers: { openrouter: { key: "k", addedAt: "2026-01-01", source: "paste" } } } satisfies AiSettings;
const profile = emptyProfile();

describe("getSetupProgress", () => {
  it("calcula o passo nos quatro casos", () => {
    expect(getSetupProgress(null, null)).toEqual({ aiReady: false, cvReady: false, step: 1 });
    expect(getSetupProgress(ai, null)).toEqual({ aiReady: true, cvReady: false, step: 2 });
    expect(getSetupProgress(null, profile)).toEqual({ aiReady: false, cvReady: true, step: 1 });
    expect(getSetupProgress(ai, profile)).toEqual({ aiReady: true, cvReady: true, step: 3 });
  });

  it("sem provedores a IA não está pronta", () => {
    expect(getSetupProgress(defaultAiSettings(), null).aiReady).toBe(false);
  });
});

describe("safeReturnPath", () => {
  it("aceita vaga e gerador por número", () => {
    expect(safeReturnPath("/vagas/4059")).toBe("/vagas/4059");
    expect(safeReturnPath("/gerador/12")).toBe("/gerador/12");
  });

  it.each(["//evil.com", "https://x.com/vagas/1", "/vagas/../perfil", "/vagas/1?x=1", "javascript:alert(1)", "/vagas/abc", "", null, undefined])(
    "rejeita %s",
    (raw) => {
      expect(safeReturnPath(raw as string | null | undefined)).toBeNull();
    },
  );
});

describe("withReturn", () => {
  it("codifica o retorno válido e ignora o inválido", () => {
    expect(withReturn("/perfil", "/vagas/4059")).toBe("/perfil?voltar=%2Fvagas%2F4059");
    expect(withReturn("/perfil", "//evil.com")).toBe("/perfil");
    expect(withReturn("/configuracoes", null)).toBe("/configuracoes");
  });
});
