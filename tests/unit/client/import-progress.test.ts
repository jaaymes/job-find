import { describe, expect, it } from "vitest";
import {
  expectedOutputChars,
  formatFound,
  nextProgress,
  rawProgress,
  summarizePartial,
  type ProgressInput,
} from "@/lib/client/profile/import-progress";

const at = (phase: ProgressInput["phase"], extra: Partial<ProgressInput> = {}): ProgressInput => ({
  phase,
  phaseStartedAt: 0,
  cvLength: 10000,
  receivedChars: 0,
  ...extra,
});

describe("expectedOutputChars", () => {
  it("usa 1,2× o tamanho do CV, entre 1500 e 40000", () => {
    expect(expectedOutputChars(200)).toBe(1500);
    expect(expectedOutputChars(10000)).toBe(12000);
    expect(expectedOutputChars(100000)).toBe(40000);
  });
});

describe("rawProgress", () => {
  it("leitura: começa em 0 e nunca chega a 15", () => {
    expect(rawProgress(at("reading"), 0)).toBe(0);
    const late = rawProgress(at("reading"), 60000);
    expect(late).toBeLessThan(15);
    expect(late).toBeGreaterThan(14.9);
  });

  it("esperando a IA: de 15 para perto de 30 pelo tempo", () => {
    expect(rawProgress(at("waiting"), 0)).toBe(15);
    expect(rawProgress(at("waiting"), 8000)).toBeCloseTo(24.48, 1);
    expect(rawProgress(at("waiting"), 600000)).toBeLessThan(30);
  });

  it("respondendo: proporcional ao recebido, limitado a 95", () => {
    expect(rawProgress(at("streaming", { receivedChars: 6000 }), 0)).toBe(62.5);
    expect(rawProgress(at("streaming", { receivedChars: 50000 }), 0)).toBe(95);
  });

  it("CV curto usa o piso de 1500 caracteres", () => {
    expect(rawProgress(at("streaming", { cvLength: 200, receivedChars: 300 }), 0)).toBe(43);
  });

  it("fim: 100", () => {
    expect(rawProgress(at("done"), 0)).toBe(100);
  });

  it("relógio antes do início da etapa conta como 0", () => {
    expect(rawProgress(at("waiting", { phaseStartedAt: 1000 }), 0)).toBe(15);
  });
});

describe("nextProgress", () => {
  it("nunca volta", () => {
    expect(nextProgress(40, at("streaming"), 0)).toBe(40);
  });
  it("arredonda para inteiro", () => {
    expect(nextProgress(0, at("streaming", { receivedChars: 6000 }), 0)).toBe(63);
  });
});

describe("summarizePartial", () => {
  it("conta os itens e lê o cargo", () => {
    expect(summarizePartial({ experiences: [{}, {}], skills: [{}], education: [], headline: "Dev" })).toEqual({
      experiences: 2,
      skills: 1,
      education: 0,
      headline: "Dev",
    });
  });
  it.each([null, [], { experiences: "x" }, "texto", 3])("formato estranho (%j) vira zeros", (p) => {
    expect(summarizePartial(p)).toEqual({ experiences: 0, skills: 0, education: 0, headline: null });
  });
  it("cargo vazio vira null", () => {
    expect(summarizePartial({ headline: "  " }).headline).toBeNull();
  });
});

describe("formatFound", () => {
  it("plural", () => {
    expect(formatFound({ experiences: 3, skills: 14, education: 1, headline: null })).toBe(
      "Encontrado até agora: 3 experiências · 14 competências · 1 formação",
    );
  });
  it("singular e itens zerados somem", () => {
    expect(formatFound({ experiences: 1, skills: 1, education: 0, headline: null })).toBe(
      "Encontrado até agora: 1 experiência · 1 competência",
    );
  });
  it("nada encontrado: null", () => {
    expect(formatFound({ experiences: 0, skills: 0, education: 0, headline: "Dev" })).toBeNull();
  });
});
