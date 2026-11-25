import { describe, expect, it } from "vitest";
import { SOURCES, SOURCE_IDS, SOURCE_LABELS, SOURCE_TRUST } from "@/lib/shared/sources";

describe("catálogo de fontes", () => {
  it("ids são únicos", () => expect(new Set(SOURCE_IDS).size).toBe(SOURCES.length));
  it("todo rótulo é não vazio", () => SOURCES.forEach((s) => expect(s.label.trim()).not.toBe("")));
  it("confiança é 1, 2 ou 3", () => SOURCES.forEach((s) => expect([1, 2, 3]).toContain(s.trust)));
  it("mantém os valores atuais", () => {
    expect(SOURCE_LABELS.wwr).toBe("We Work Remotely");
    expect(SOURCE_TRUST.greenhouse).toBe(3);
    expect(SOURCE_TRUST.hn).toBe(1);
    expect(SOURCE_IDS.length).toBe(15);
  });
});
