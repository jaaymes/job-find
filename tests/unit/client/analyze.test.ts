import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "@/lib/client/ai/errors";
import { htmlToText, JOB_FIT_V1, projectProfile } from "@/lib/client/ai/prompts/job.fit.v1";
import { defaultAiSettings } from "@/lib/client/ai/settings";
import { analysisStore, analyzeJob } from "@/lib/client/jobs/analyze";
import { indexProfile, scoreJob } from "@/lib/client/score/score";
import { normalizeFit } from "@/lib/shared/schemas/fit";
import { emptyProfile, type Profile } from "@/lib/shared/schemas/profile";
import type { JobDetail } from "@/lib/shared/types/job";
import { aiFailure } from "@/components/ai/messages";

const generate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client/ai/generate", () => ({ generateStructured: generate }));

const EMAIL = "ana.exemplo@exemplo.test";
const PHONE = "98888-7777";
const STREET = "Rua das Flores, 123";

const profile = (): Profile => ({
  ...emptyProfile(),
  name: "Ana Exemplo",
  headline: `Dev (${EMAIL})`,
  location: "São Paulo, SP, Brasil",
  seniority: "senior",
  englishLevel: "advanced",
  summary: `Moro na ${STREET}. Contato: (11) ${PHONE}.`,
  contact: { email: EMAIL, phone: `(11) ${PHONE}`, links: ["https://github.com/ana-exemplo"] },
  skills: [{ name: "React", years: 5, stackId: "react" }],
  experiences: [
    {
      id: "exp_1",
      company: "Empresa Ficticia",
      title: "Dev",
      startDate: "2020-01",
      endDate: null,
      bullets: [{ id: "exp_1.b1", text: `Escreva para ${EMAIL} sobre o projeto` }],
    },
  ],
  education: [],
});

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
  descriptionHtml: "<h2>Requisitos</h2><ul><li>React</li><li>GraphQL</li></ul><script>alert(1)</script>",
  attribution: [],
  ...over,
});

const fit = { strengths: ["a"], gaps: ["b"], missingKeywords: ["GraphQL"], revisedScore: 81 };

beforeEach(() => {
  window.localStorage.clear();
  generate.mockReset();
  generate.mockResolvedValue({ data: fit, provider: "deepseek", model: "deepseek-chat" });
});

const build = (over: Partial<JobDetail> = {}) => {
  const p = profile();
  const j = job(over);
  const local = scoreJob(indexProfile(p), j, new Date("2026-11-23T13:00:00Z"));
  return JOB_FIT_V1.buildUser({ profile: p, job: j, local });
};

describe("job.fit.v1", () => {
  it("não leva e-mail, telefone, endereço, nome nem links de contato", () => {
    const sent = `${JOB_FIT_V1.system}\n${build()}`;
    for (const secret of [EMAIL, PHONE, STREET, "Ana Exemplo", "github.com/ana-exemplo"]) {
      expect(sent).not.toContain(secret);
    }
    expect(sent).toContain("React");
  });

  it("projeta o perfil sem `contact`", () => {
    expect(projectProfile(profile())).not.toHaveProperty("contact");
    expect(projectProfile(profile())).not.toHaveProperty("name");
  });

  it("coloca a vaga num bloco não confiável, em texto puro, sem scripts", () => {
    const text = build();
    expect(text).toMatch(/<job_description id="[a-z0-9]{8}">/);
    expect(text).toContain("GraphQL");
    expect(text).not.toContain("<li>");
    expect(text).not.toContain("alert(1)");
  });

  it("trunca a descrição em 12 mil caracteres", () => {
    const text = build({ descriptionHtml: `<p>${"x".repeat(20_000)}</p>` });
    expect(text.match(/x/g)?.length).toBeLessThanOrEqual(12_000);
  });

  it("htmlToText separa blocos por quebra de linha", () => {
    expect(htmlToText("<p>a</p><p>b</p>")).toBe("a\nb");
  });
});

describe("normalizeFit", () => {
  it("limita a nota a 0-100", () => {
    expect(normalizeFit({ ...fit, revisedScore: 150 }).revisedScore).toBe(100);
    expect(normalizeFit({ ...fit, revisedScore: -3 }).revisedScore).toBe(0);
    expect(normalizeFit({ ...fit, revisedScore: 80.6 }).revisedScore).toBe(81);
  });
});

describe("analyzeJob", () => {
  it("chama a tarefa analyze e grava o registro em aiAnalysis[jobId]", async () => {
    const { record, saved } = await analyzeJob({
      job: job(),
      profile: profile(),
      settings: defaultAiSettings(),
      now: new Date("2026-11-23T13:00:00Z"),
    });
    expect(generate.mock.calls[0][0].task).toBe("analyze");
    expect(saved).toEqual({ ok: true });
    expect(record).toMatchObject({ ...fit, provider: "deepseek", model: "deepseek-chat", promptVersion: 1 });
    expect(analysisStore.get()["7"]).toEqual(record);
    expect(analysisStore.get()["7"].createdAt).toBe("2026-11-23T13:00:00.000Z");
    expect(JSON.parse(window.localStorage.getItem("jobfind:v1:aiAnalysis") ?? "{}").data["7"].model).toBe("deepseek-chat");
  });

  it("o resultado salvo reaparece sem nova chamada e outras vagas são preservadas", async () => {
    await analyzeJob({ job: job({ id: 1 }), profile: profile(), settings: defaultAiSettings() });
    await analyzeJob({ job: job({ id: 2 }), profile: profile(), settings: defaultAiSettings() });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(Object.keys(analysisStore.get()).sort()).toEqual(["1", "2"]);
  });

  it("limita a nota devolvida pelo modelo", async () => {
    generate.mockResolvedValue({ data: { ...fit, revisedScore: 250 }, provider: "deepseek", model: "m" });
    const { record } = await analyzeJob({ job: job(), profile: profile(), settings: defaultAiSettings() });
    expect(record.revisedScore).toBe(100);
  });

  it("devolve o registro mesmo quando a gravação falha", async () => {
    const failing = { get: () => ({}), set: () => ({ ok: false as const, reason: "quota" as const }), subscribe: () => () => {} };
    const { record, saved } = await analyzeJob({ job: job(), profile: profile(), settings: defaultAiSettings(), store: failing });
    expect(saved).toEqual({ ok: false, reason: "quota" });
    expect(record.revisedScore).toBe(81);
  });

  it("repassa o erro da IA sem gravar nada", async () => {
    generate.mockRejectedValue(new AiError("no_credit"));
    await expect(analyzeJob({ job: job(), profile: profile(), settings: defaultAiSettings() })).rejects.toMatchObject({
      code: "no_credit",
    });
    expect(analysisStore.get()).toEqual({});
  });
});

describe("aiFailure", () => {
  it("no_credit mostra a mensagem exata", () => {
    expect(aiFailure(new AiError("no_credit"), { noProvider: "", truncated: "", fallback: "" })).toBe("Sem crédito, recarregue");
  });
});
