import { beforeEach, describe, expect, it } from "vitest";
import { generatedStore } from "@/lib/client/cv/generated-store";
import { cvPrefsStore, resolveTemplateId, type CvPrefs } from "@/lib/client/pdf/templates/prefs";
import { recommendTemplate } from "@/lib/client/pdf/templates/recommend";
import { normalizeSkill } from "@/lib/shared/stacks";
import { emptyProfile, type Profile } from "@/lib/shared/schemas/profile";
import type { JobDetail } from "@/lib/shared/types/job";

const job = (over: Partial<JobDetail> = {}): JobDetail => ({
  id: 7,
  title: "Dev React",
  company: "Acme",
  companyLogoUrl: null,
  summary: "r",
  country: "BR",
  city: "São Paulo",
  origin: "national",
  acceptsBrazil: true,
  workMode: "remote",
  seniority: "senior",
  language: "pt",
  stacks: ["react"],
  sources: ["himalayas"],
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
  publishedAt: "2026-11-23T12:00:00.000Z",
  urlCanonical: "https://x.test/1",
  applyUrl: null,
  descriptionHtml: "<p>x</p>",
  attribution: [],
  ...over,
});

const exp = (title: string, bullet = "Fez coisas") => ({
  id: "exp_1",
  company: "Escola",
  title,
  startDate: "2020-01",
  endDate: null,
  bullets: [{ id: "exp_1.b1", text: bullet }],
});

const profile = (over: Partial<Profile> = {}): Profile => ({
  ...emptyProfile(),
  seniority: "mid",
  experiences: [exp("Dev", "Criou APIs em Node.js")],
  ...over,
});

describe("recommendTemplate", () => {
  it("vaga em inglês com senior -> internacional", () => {
    expect(recommendTemplate(profile({ seniority: "senior" }), job({ language: "en" }))).toBe("internacional");
  });
  it("lead -> lideranca", () => {
    expect(recommendTemplate(profile({ seniority: "lead" }), job())).toBe("lideranca");
  });
  it("junior -> inicio-de-carreira", () => {
    expect(recommendTemplate(profile({ seniority: "junior" }), job())).toBe("inicio-de-carreira");
  });
  it("sem experiências -> inicio-de-carreira", () => {
    expect(recommendTemplate(profile({ experiences: [] }), job())).toBe("inicio-de-carreira");
  });
  it("projeto e experiência sem stack -> transicao", () => {
    const p = profile({
      projects: [{ id: "proj_1", name: "App", link: null, stacks: ["react"], bullets: [] }],
      experiences: [exp("Professora de matemática")],
    });
    expect(recommendTemplate(p, job())).toBe("transicao");
  });
  it("stack de duas palavras num bullet conta como stack", () => {
    // "c sharp" só resolve como par: as palavras soltas não são stacks.
    expect(normalizeSkill("c")).toBeNull();
    expect(normalizeSkill("sharp")).toBeNull();
    expect(normalizeSkill("c sharp")).not.toBeNull();
    const p = profile({
      seniority: "senior",
      projects: [{ id: "proj_1", name: "App", link: null, stacks: [], bullets: [] }],
      experiences: [exp("Analista", "Sistemas internos em C Sharp")],
    });
    expect(recommendTemplate(p, job())).toBe("resultados");
  });
  it("precedência: vaga em inglês vence lead", () => {
    expect(recommendTemplate(profile({ seniority: "lead" }), job({ language: "en" }))).toBe("internacional");
  });
  it("precedência: transição vence senior", () => {
    const p = profile({
      seniority: "senior",
      projects: [{ id: "proj_1", name: "App", link: null, stacks: [], bullets: [] }],
      experiences: [exp("Professora de matemática")],
    });
    expect(recommendTemplate(p, job())).toBe("transicao");
  });
  it("senior em vaga pt -> resultados", () => {
    expect(recommendTemplate(profile({ seniority: "senior" }), job())).toBe("resultados");
  });
  it("mid -> classico", () => {
    expect(recommendTemplate(profile({ seniority: "mid" }), job())).toBe("classico");
  });
  it("job null conta como vaga em pt", () => {
    expect(recommendTemplate(profile({ seniority: "senior" }), null)).toBe("resultados");
  });
});

describe("resolveTemplateId", () => {
  const prefs = (templateId: string | null): CvPrefs => ({ templateId });
  it("o registro vence a preferência", () => {
    expect(resolveTemplateId("harvard", prefs("moderno"), profile(), job())).toBe("harvard");
  });
  it("registro null usa a preferência", () => {
    expect(resolveTemplateId(null, prefs("moderno"), profile(), job())).toBe("moderno");
  });
  it("id inválido cai para o próximo nível", () => {
    expect(resolveTemplateId("xyz", prefs(null), profile({ seniority: "lead" }), job())).toBe("lideranca");
    expect(resolveTemplateId("xyz", prefs("moderno"), profile(), job())).toBe("moderno");
    expect(resolveTemplateId(undefined, prefs("abc"), profile({ seniority: "mid" }), job())).toBe("classico");
  });
});

describe("cvPrefsStore e generatedStore v2", () => {
  beforeEach(() => localStorage.clear());
  it("cvPrefs começa com templateId null", () => {
    expect(cvPrefsStore.get()).toEqual({ templateId: null });
  });
  it("registro v1 sem templateId continua legível, com null", () => {
    const rec = {
      cv: { headline: "h", summary: "s", skills: [], experiences: [] },
      coverLetter: null,
      provider: "openai",
      model: "m",
      promptVersion: 1,
      createdAt: "x",
      lang: "pt",
      includeLetter: false,
      edits: null,
      approvedFlags: [],
    };
    localStorage.setItem("jobfind:v1:generatedDocs", JSON.stringify({ v: 1, data: { "7": rec } }));
    expect(generatedStore.get()["7"].templateId).toBeNull();
  });
});
