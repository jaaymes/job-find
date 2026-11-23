import { describe, expect, it } from "vitest";
import { detectSeniority } from "@/lib/server/enrich/seniority";

describe("detectSeniority", () => {
  it.each([
    ["Desenvolvedor Pleno React", "mid"],
    ["Staff Engineer", "lead"],
    ["Estágio em Dados", "intern"],
    ["Dev Júnior", "junior"],
    ["Engenheiro Sênior", "senior"],
    ["Sr. Backend Developer", "senior"],
    ["Software Engineer Intern", "intern"],
    ["Tech Lead", "lead"],
    ["Backend Developer", null],
  ] as const)("%s -> %s", (title, expected) => {
    expect(detectSeniority(title, null)).toBe(expected);
  });
  it("hint vence", () => {
    expect(detectSeniority("Dev Júnior", "senior")).toBe("senior");
  });
});
