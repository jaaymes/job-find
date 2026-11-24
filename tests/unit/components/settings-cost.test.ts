import { describe, expect, it } from "vitest";
import { estimateCost } from "@/components/settings/cost";

describe("estimateCost", () => {
  it("calcula o custo por operação a partir de USD por milhão de tokens", () => {
    // 3000 * 0,1 + 800 * 0,4 = 620 -> US$ 0,00062
    expect(estimateCost("analyze", { priceIn: 0.1, priceOut: 0.4 })).toBe("≈ US$ 0,0006 por vaga");
  });
  it("usa 2 casas a partir de 1 centavo", () => {
    expect(estimateCost("cv", { priceIn: 5, priceOut: 15 })).toBe("≈ US$ 0,05 por CV");
  });
  it("preço zero é grátis; sem preço, informa que não há dado", () => {
    expect(estimateCost("extract", { priceIn: 0, priceOut: 0 })).toBe("grátis por currículo");
    expect(estimateCost("cv", { })).toBe("custo não informado pelo provedor");
    expect(estimateCost("cv", undefined)).toBe("custo não informado pelo provedor");
  });
});
