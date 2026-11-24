import { describe, expect, it } from "vitest";
import { detectLanguage } from "@/lib/server/enrich/language";

const pt =
  "Estamos procurando uma pessoa desenvolvedora para atuar no time de produto, construindo funcionalidades novas, revisando código e colaborando com designers e gerentes. Você trabalhará com uma equipe distribuída em todo o Brasil, com horários flexíveis e muitos benefícios.";
const en =
  "We are looking for a developer to join our product team, building new features, reviewing code and collaborating with designers and managers. You will work with a distributed team around the world, with flexible hours and plenty of benefits for everyone.";

describe("detectLanguage", () => {
  it("texto curto é unknown", () => {
    expect(detectLanguage("curto")).toBe("unknown");
  });
  it("português", () => {
    expect(pt.length).toBeGreaterThanOrEqual(200);
    expect(detectLanguage(pt)).toBe("pt");
  });
  it("inglês", () => {
    expect(en.length).toBeGreaterThanOrEqual(200);
    expect(detectLanguage(en)).toBe("en");
  });
});
