import { describe, expect, it } from "vitest";
import { estimateCost, priceLabel, sortModelsByCost } from "@/components/settings/cost";

describe("sortModelsByCost / priceLabel", () => {
  it("ordena grátis, depois do mais barato ao mais caro, e sem preço no fim em ordem alfabética", () => {
    const ids = sortModelsByCost("extract", [
      { id: "c", label: "Caro", priceIn: 10, priceOut: 30 },
      { id: "z", label: "Zeta" },
      { id: "f", label: "Free", priceIn: 0, priceOut: 0 },
      { id: "b", label: "Barato", priceIn: 0.1, priceOut: 0.4 },
      { id: "a", label: "Alfa" },
    ]).map((m) => m.id);
    expect(ids).toEqual(["f", "b", "c", "a", "z"]);
  });
  it("empate de custo desempata por rótulo e depois por id", () => {
    const ids = sortModelsByCost("extract", [
      { id: "x2", label: "X", priceIn: 1, priceOut: 1 },
      { id: "y", label: "A", priceIn: 1, priceOut: 1 },
      { id: "x1", label: "X", priceIn: 1, priceOut: 1 },
    ]).map((m) => m.id);
    expect(ids).toEqual(["y", "x1", "x2"]);
  });
  it("não muta a lista recebida", () => {
    const input = [
      { id: "c", label: "Caro", priceIn: 10, priceOut: 30 },
      { id: "f", label: "Free", priceIn: 0, priceOut: 0 },
    ];
    const copy = [...input];
    const out = sortModelsByCost("extract", input);
    expect(out).not.toBe(input);
    expect(input).toEqual(copy);
    expect(input.map((m) => m.id)).toEqual(["c", "f"]);
  });
  it("ordena modelos de provedores diferentes juntos: grátis, mais barato, mais caro, sem preço em ordem alfabética", () => {
    const ids = sortModelsByCost("analyze", [
      { id: "b", label: "Beta" },
      { id: "a", label: "Alfa" },
      { id: "caro", label: "Caro", priceIn: 5, priceOut: 15 },
      { id: "barato", label: "Barato", priceIn: 0.1, priceOut: 0.4 },
      { id: "gratis", label: "Grátis", priceIn: 0, priceOut: 0 },
    ]).map((m) => m.id);
    expect(ids).toEqual(["gratis", "barato", "caro", "a", "b"]);
  });
  it("priceLabel", () => {
    expect(priceLabel("extract", { id: "f", label: "F", priceIn: 0, priceOut: 0 })).toBe("grátis");
    expect(priceLabel("extract", { id: "z", label: "Z" })).toBe("");
    expect(priceLabel("analyze", { id: "b", label: "B", priceIn: 0.1, priceOut: 0.4 })).toBe("≈ US$ 0,0006 por vaga");
  });
});

describe("estimateCost", () => {
  it("calcula o custo por operação a partir de USD por milhão de tokens", () => {
    // 3000 * 0,1 + 800 * 0,4 = 620 -> US$ 0,00062
    expect(estimateCost("analyze", { priceIn: 0.1, priceOut: 0.4 })).toBe("≈ US$ 0,0006 por vaga");
  });
  it("a leitura do currículo considera 3000 tokens de saída", () => {
    // (4000 * 1 + 3000 * 2) / 1e6 = 0,0100
    expect(estimateCost("extract", { priceIn: 1, priceOut: 2 })).toBe("≈ US$ 0,01 por currículo");
  });
  it("usa 2 casas a partir de 1 centavo", () => {
    expect(estimateCost("cv", { priceIn: 5, priceOut: 15 })).toBe("≈ US$ 0,05 por CV");
  });
  it("preço zero é grátis; sem preço, devolve undefined", () => {
    expect(estimateCost("extract", { priceIn: 0, priceOut: 0 })).toBe("grátis por currículo");
    expect(estimateCost("cv", {})).toBeUndefined();
    expect(estimateCost("cv", undefined)).toBeUndefined();
  });
});
