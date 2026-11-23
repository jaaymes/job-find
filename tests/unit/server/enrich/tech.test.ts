import { describe, expect, it } from "vitest";
import { isTechJob } from "@/lib/server/enrich/tech";

describe("isTechJob", () => {
  it("marketing é falso", () => {
    expect(isTechJob("Analista de Marketing", ["marketing"])).toBe(false);
    expect(isTechJob("Analista de RH", [])).toBe(false);
    expect(isTechJob("Analista Financeiro", [])).toBe(false);
  });
  it("QA Engineer é tech", () => {
    expect(isTechJob("QA Engineer", [])).toBe(true);
  });
  it("Analista de Dados é tech", () => {
    expect(isTechJob("Analista de Dados", [])).toBe(true);
  });
  it("tag de stack é tech", () => {
    expect(isTechJob("Especialista", ["react"])).toBe(true);
  });
  it.each([
    "Desenvolvedora Backend",
    "Engenheiro de Software",
    "Site Reliability SRE",
    "DevOps Lead",
    "Cientista de Dados",
    "Product Designer",
    "Full-stack Developer",
    "Programador PHP",
  ])("%s", (t) => {
    expect(isTechJob(t, [])).toBe(true);
  });
  it("não casa dentro de palavras", () => {
    expect(isTechJob("Gerente de Qualidade Industrial", [])).toBe(false);
  });
});
