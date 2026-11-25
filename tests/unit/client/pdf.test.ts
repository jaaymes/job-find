// @vitest-environment node
import { resolve } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import type { AssembledCv } from "@/lib/client/cv/assemble";
import { cvFileName } from "@/lib/client/pdf/filename";
import { renderCvPdf, renderLetterPdf } from "@/lib/client/pdf/render";

const FONTS = resolve(import.meta.dirname, "../../../public/fonts");
const FLAGGED = "Reduziu custos em 40% sem evidência";
const OK_FLAG = { key: "k", flagged: false, violations: [] };

const cvFixture = (over: Partial<AssembledCv> = {}): AssembledCv => ({
  name: "Ana Souza",
  contactLine: "ana@exemplo.test | São Paulo, SP | github.com/ana",
  headline: "Engenheira Frontend Sênior",
  summary: "Oito anos construindo interfaces acessíveis e rápidas.",
  skills: ["React", "TypeScript", "Segredoskill"],
  education: ["Ciência da Computação – USP (2012 – 2016)"],
  location: "",
  projects: [],
  certifications: [],
  languages: [],
  highlightKeys: [],
  lang: "pt",
  experiences: [
    {
      expId: "exp_1",
      occurrence: 0,
      company: "Lumen Pay",
      role: "Frontend Sênior",
      period: "jan 2021 – atual",
      bullets: [
        { key: "b1", text: "Liderou a migração para Next.js em São Paulo.", sources: [], flagged: false, violations: [] },
        { key: "b2", text: FLAGGED, sources: [], flagged: true, violations: [] },
      ],
    },
  ],
  flags: { headline: OK_FLAG, summary: OK_FLAG, skills: [OK_FLAG, OK_FLAG, { ...OK_FLAG, flagged: true }] },
  ...over,
});

async function textOf(blob: Blob): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
  return (await extractText(pdf, { mergePages: true })).text;
}

describe("renderCvPdf", () => {
  it("gera PDF legível pelo ATS, sem trechos sinalizados", async () => {
    const { blob, pages } = await renderCvPdf(cvFixture(), "classico", FONTS);
    const text = await textOf(blob);
    expect(text).toContain("Experiência");
    expect(text).toContain("Resumo");
    expect(text).toContain("Competências");
    expect(text).toContain("Formação");
    expect(text).toContain("São Paulo");
    expect(text).toContain("Liderou a migração");
    expect(text).not.toContain("sem evidência");
    expect(text).not.toContain("Segredoskill");
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(pages).toBeLessThanOrEqual(2);
  });

  it("separa o nome do título no texto extraído (ATS)", async () => {
    const text = await textOf((await renderCvPdf(cvFixture(), "classico", FONTS)).blob);
    expect(text).toMatch(/Ana Souza\s+Engenheira Frontend Sênior/);
  });

  it("deixa de fora bullets, skills, resumo e título vazios (só espaços)", async () => {
    const base = cvFixture();
    const cv = cvFixture({
      headline: "   ",
      summary: " \n ",
      skills: ["React", "  ", "TypeScript"],
      flags: { headline: OK_FLAG, summary: OK_FLAG, skills: [OK_FLAG, OK_FLAG, OK_FLAG] },
      experiences: [
        { ...base.experiences[0], bullets: [{ key: "b1", text: "Liderou a migração.", sources: [], flagged: false, violations: [] }, { key: "b3", text: "   ", sources: [], flagged: false, violations: [] }] },
      ],
    });
    const text = await textOf((await renderCvPdf(cv, "classico", FONTS)).blob);
    expect(text).not.toContain("Resumo");
    expect(text).toContain("React, TypeScript");
    expect(text).not.toMatch(/-\s*$/m);
    expect(text).not.toMatch(/^\s*-\s*$/m);
  });

  it("experiência repetida (occurrence > 0) ou com violação de experiência não vira cabeçalho duplicado", async () => {
    const base = cvFixture().experiences[0];
    const expViolation = { kind: "unknown_exp" as const, text: "exp_1", where: { expId: "exp_1", part: "cv" as const }, key: "e" };
    const cv = cvFixture({
      experiences: [
        { ...base, bullets: [base.bullets[0]] },
        { ...base, occurrence: 1, bullets: [{ key: "r1", text: "Bullet da repetição", sources: [], flagged: false, violations: [] }] },
        { ...base, expId: "exp_2", company: "Outra Repetida", bullets: [{ key: "x1", text: "Bullet inválido", sources: [], flagged: false, violations: [expViolation] }] },
      ],
    });
    const text = await textOf((await renderCvPdf(cv, "classico", FONTS)).blob);
    expect(text.match(/Lumen Pay/g)).toHaveLength(1);
    expect(text).not.toContain("Bullet da repetição");
    expect(text).not.toContain("Outra Repetida");
  });

  it("deixa de fora summary e headline sinalizados, e seção vazia", async () => {
    const cv = cvFixture({ flags: { headline: { ...OK_FLAG, flagged: true }, summary: { ...OK_FLAG, flagged: true }, skills: [] }, skills: [] });
    const text = await textOf((await renderCvPdf(cv, "classico", FONTS)).blob);
    expect(text).not.toContain("Oito anos");
    expect(text).not.toContain("Engenheira Frontend");
    expect(text).not.toContain("Resumo");
    expect(text).not.toContain("Competências");
    expect(text).toContain("Experiência");
  });

  it("conta as páginas quando o CV é longo", async () => {
    const bullets = Array.from({ length: 60 }, (_, i) => ({ key: `b${i}`, text: `Entrega número ${i} com impacto mensurável no produto.`, sources: [] as string[], flagged: false, violations: [] }));
    const base = cvFixture();
    const cv = cvFixture({ experiences: [{ ...base.experiences[0], bullets }] });
    expect((await renderCvPdf(cv, "classico", FONTS)).pages).toBeGreaterThanOrEqual(2);
  });

  it("usa os cabeçalhos do idioma do CV", async () => {
    const text = await textOf((await renderCvPdf(cvFixture({ lang: "en" }), "classico", FONTS)).blob);
    expect(text).toContain("Experience");
    expect(text).toContain("Skills");
  });
});

describe("renderLetterPdf", () => {
  it("renderiza a carta com nome e contato do CV, sem filtrar", async () => {
    const { blob, pages } = await renderLetterPdf("Prezados,\n\nTenho interesse na vaga.\n\nAtenciosamente.", cvFixture(), FONTS);
    const text = await textOf(blob);
    expect(text).toContain("Ana Souza");
    expect(text).toContain("São Paulo");
    expect(text).toContain("Tenho interesse na vaga.");
    expect(pages).toBe(1);
  });
});

describe("cvFileName", () => {
  it("monta o nome sem acento", () => {
    expect(cvFileName("Ana Souza", "Lumen Pay", "Frontend Sênior")).toBe("CV-Ana-Souza-Lumen-Pay-Frontend-Senior.pdf");
  });
  it("omite segmentos vazios", () => {
    expect(cvFileName("", "Lumen Pay", "Dev")).toBe("CV-Lumen-Pay-Dev.pdf");
    expect(cvFileName("   ", "  ", "")).toBe("CV.pdf");
    expect(cvFileName("Ana", "", "Dev")).toBe("CV-Ana-Dev.pdf");
  });
  it("remove caracteres inválidos e colapsa hifens", () => {
    expect(cvFileName("Ana / Souza", 'A:B*C?"<>|', "x - - y")).toBe("CV-Ana-Souza-ABC-x-y.pdf");
  });
  it("limita a 120 caracteres com .pdf", () => {
    const n = cvFileName("a".repeat(200), "b", "c");
    expect(n.length).toBeLessThanOrEqual(120);
    expect(n.endsWith(".pdf")).toBe(true);
    expect(n.includes("-.pdf")).toBe(false);
  });
  it("remove invisíveis e controles bidi (\\p{Cf})", () => {
    expect(cvFileName("Ana\u200b Souza", "Acme\u202Efdp.exe", "Dev\u2066")).toBe("CV-Ana-Souza-Acmefdp.exe-Dev.pdf");
  });
  it("não parte um emoji (par substituto) ao truncar", () => {
    const n = cvFileName("a".repeat(112), "😀😀😀", "c");
    expect(n.length).toBeLessThanOrEqual(120);
    expect(n).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(n.endsWith(".pdf")).toBe(true);
  });
  it("não termina em '..pdf'", () => {
    expect(cvFileName("Ana", "Acme", "Dev Sr.")).toBe("CV-Ana-Acme-Dev-Sr.pdf");
    expect(cvFileName("Ana", "Acme", "...")).toBe("CV-Ana-Acme.pdf");
  });
});
