import { describe, expect, it } from "vitest";
import { classifyWorkMode } from "@/lib/server/enrich/work-mode";

describe("classifyWorkMode", () => {
  it("texto home office é remoto", () => {
    expect(classifyWorkMode(null, "Vaga 100% home office")).toBe("remote");
  });
  it("campo vence texto", () => {
    expect(classifyWorkMode("onsite", "remote friendly")).toBe("onsite");
  });
  it("híbrido", () => {
    expect(classifyWorkMode(null, "Modelo híbrido, 2x na semana")).toBe("hybrid");
  });
  it("híbrido vence remoto", () => {
    expect(classifyWorkMode(null, "Hybrid, remote on Fridays")).toBe("hybrid");
  });
  it("presencial", () => {
    expect(classifyWorkMode(null, "Vaga presencial em SP")).toBe("onsite");
    expect(classifyWorkMode(null, "On-site")).toBe("onsite");
  });
  it("hint unknown cai no texto", () => {
    expect(classifyWorkMode("unknown", "work from home")).toBe("remote");
  });
  it("vazio é unknown", () => {
    expect(classifyWorkMode(null, "")).toBe("unknown");
  });
});
