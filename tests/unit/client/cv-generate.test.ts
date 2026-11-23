import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "@/lib/client/ai/errors";
import { defaultAiSettings } from "@/lib/client/ai/settings";
import { generateDocs } from "@/lib/client/cv/generate";
import { generatedStore, docsOf, type GeneratedRecord } from "@/lib/client/cv/generated-store";
import { reviewDocs } from "@/lib/client/cv/review";
import { emptyProfile, type Profile } from "@/lib/shared/schemas/profile";
import type { TailoredDocs } from "@/lib/shared/schemas/tailored";
import type { JobDetail } from "@/lib/shared/types/job";

const generate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client/ai/generate", () => ({ generateStructured: generate }));

const EMAIL = "ana.exemplo@exemplo.test";
const profile = (): Profile => ({
  ...emptyProfile(),
  name: "Ana Exemplo",
  contact: { email: EMAIL, phone: "(11) 98888-7777", links: [] },
  skills: [{ name: "React", years: 5, stackId: "react" }],
  experiences: [
    {
      id: "exp_1",
      company: "Empresa Ficticia",
      title: "Dev",
      startDate: "2020-01",
      endDate: null,
      bullets: [{ id: "exp_1.b1", text: "Reduziu o tempo de carregamento em 40% com React" }],
    },
  ],
});

const job = { id: 7, title: "Dev React", company: "Acme", summary: "r", descriptionHtml: "<p>React</p>", language: "pt", stacks: ["react"], workMode: "remote", seniority: "senior", city: null, country: "BR" } as unknown as JobDetail;

const docs = (over: Partial<TailoredDocs["cv"]> = {}, coverLetter: string | null = null): TailoredDocs => ({
  cv: {
    headline: "Dev React",
    summary: "Experiência com React.",
    skills: ["React"],
    experiences: [{ expId: "exp_1", bullets: [{ text: "Reduziu o tempo de carregamento em 40% com React.", sourceBulletIds: ["exp_1.b1"] }] }],
    ...over,
  },
  coverLetter,
});

beforeEach(() => {
  generate.mockReset();
  window.localStorage.clear();
});

describe("generateDocs", () => {
  it("chama a IA com a tarefa cv, a vaga e o idioma, e grava o registro por jobId", async () => {
    generate.mockResolvedValue({ data: docs({}, "Carta"), provider: "deepseek", model: "m" });
    const { record, saved } = await generateDocs({
      job,
      profile: profile(),
      settings: defaultAiSettings(),
      lang: "en",
      includeLetter: true,
      now: new Date("2026-11-23T12:00:00Z"),
    });
    const args = generate.mock.calls[0][0];
    expect(args.task).toBe("cv");
    expect(args.prompt).toContain("Escreva tudo em English");
    expect(args.prompt).toContain("Gere também a carta");
    expect(args.prompt).not.toContain(EMAIL);
    expect(record).toMatchObject({ provider: "deepseek", model: "m", promptVersion: 1, lang: "en", includeLetter: true, edits: null, approvedFlags: [], createdAt: "2026-11-23T12:00:00.000Z" });
    expect(saved.ok).toBe(true);
    expect(generatedStore.get()["7"].coverLetter).toBe("Carta");
  });

  it("descarta a carta quando não foi pedida", async () => {
    generate.mockResolvedValue({ data: docs({}, "Carta que sobrou"), provider: "deepseek", model: "m" });
    const { record } = await generateDocs({ job, profile: profile(), settings: defaultAiSettings(), lang: "pt", includeLetter: false });
    expect(record.coverLetter).toBeNull();
  });

  it("o validador (com a vaga) só reprova na 1ª resposta; na 2ª aceita e a tela destaca", async () => {
    generate.mockImplementation(async (a: { validate: (d: TailoredDocs, c: { attempt: number; last: boolean }) => string[] }) => {
      const bad = docs({ headline: "Dev React com 300 projetos" });
      expect(a.validate(bad, { attempt: 1, last: false }).length).toBeGreaterThan(0);
      expect(a.validate(bad, { attempt: 2, last: true })).toEqual([]);
      return { data: bad, provider: "deepseek", model: "m" };
    });
    const { record } = await generateDocs({ job, profile: profile(), settings: defaultAiSettings(), lang: "pt", includeLetter: false });
    const review = reviewDocs(profile(), docsOf(record), "pt", [], job);
    expect(review.flaggedCount).toBe(1);
    expect(review.cv.flags.headline.flagged).toBe(true);
  });

  it("falha sem tocar no registro anterior (edições preservadas)", async () => {
    const previous: GeneratedRecord = { ...docs(), provider: "deepseek", model: "m", promptVersion: 1, createdAt: "x", lang: "pt", includeLetter: false, edits: docs({ headline: "Editado" }), approvedFlags: ["k"] };
    generatedStore.set({ "7": previous });
    generate.mockRejectedValue(new AiError("rate_limit", { retryable: true }));
    await expect(generateDocs({ job, profile: profile(), settings: defaultAiSettings(), lang: "en", includeLetter: false })).rejects.toMatchObject({ code: "rate_limit" });
    expect(generatedStore.get()["7"].edits?.cv.headline).toBe("Editado");
    expect(generatedStore.get()["7"].approvedFlags).toEqual(["k"]);
  });

  it("repassa o parcial ao chamador", async () => {
    const onPartial = vi.fn();
    generate.mockImplementation(async (a: { onPartial: (p: unknown) => void }) => {
      a.onPartial({ cv: { headline: "Dev" } });
      return { data: docs(), provider: "deepseek", model: "m" };
    });
    await generateDocs({ job, profile: profile(), settings: defaultAiSettings(), lang: "pt", includeLetter: false, onPartial });
    expect(onPartial).toHaveBeenCalledWith({ cv: { headline: "Dev" } });
  });
});

describe("generatedStore", () => {
  it("descarta só o registro inválido e mantém os demais", () => {
    const good: GeneratedRecord = { ...docs(), provider: "deepseek", model: "m", promptVersion: 1, createdAt: "x", lang: "pt", includeLetter: false, edits: null, approvedFlags: [] };
    window.localStorage.setItem("jobfind:v1:generatedDocs", JSON.stringify({ v: 1, data: { "1": good, "2": { cv: "quebrado" }, "3": { ...good, lang: "xx" } } }));
    expect(Object.keys(generatedStore.get())).toEqual(["1"]);
  });
});

describe("reviewDocs", () => {
  it("revalida o texto editado: o número inventado volta a ser destacado e aprovar só vale para aquele texto", () => {
    const p = profile();
    const ok = reviewDocs(p, docs(), "pt", [], job);
    expect(ok.flaggedCount).toBe(0);
    const edited = docs({ experiences: [{ expId: "exp_1", bullets: [{ text: "Reduziu o tempo em 99%.", sourceBulletIds: ["exp_1.b1"] }] }] });
    const bad = reviewDocs(p, edited, "pt", [], job);
    expect(bad.flaggedCount).toBe(1);
    const key = bad.cv.experiences[0].bullets[0].key;
    expect(reviewDocs(p, edited, "pt", [key], job).flaggedCount).toBe(0);
    const edited2 = docs({ experiences: [{ expId: "exp_1", bullets: [{ text: "Reduziu o tempo em 98%.", sourceBulletIds: ["exp_1.b1"] }] }] });
    expect(reviewDocs(p, edited2, "pt", [key], job).flaggedCount).toBe(1);
  });

  it("experiência com expId desconhecido é removida e contada", () => {
    const d = docs();
    d.cv.experiences.push({ expId: "exp_9", bullets: [] });
    const r = reviewDocs(profile(), d, "pt", [], job);
    expect(r.removedExperiences).toBe(1);
    expect(r.cv.experiences).toHaveLength(1);
  });
});
