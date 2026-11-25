import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { AiError } from "@/lib/client/ai/errors";
import { PROVIDERS } from "@/lib/client/ai/providers";
import { defaultAiSettings } from "@/lib/client/ai/settings";
import * as validate from "@/lib/client/cv/validate";
import { ASSIST_INVENTED_MESSAGE, askQuestions, rewriteDraft, writeDrafts } from "@/lib/client/profile/assist";
import { emptyProfile, type Profile } from "@/lib/shared/schemas/profile";

type Chunk = Record<string, unknown>;
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const reply = (obj: unknown): Chunk[] => [
  { type: "text-start", id: "t" },
  { type: "text-delta", id: "t", delta: JSON.stringify(obj) },
  { type: "text-end", id: "t" },
  { type: "finish", usage, finishReason: { unified: "stop", raw: "stop" } },
];
const mockModel = (...objs: unknown[]) =>
  new MockLanguageModelV4({
    doStream: objs.map((o) => ({ stream: simulateReadableStream({ chunks: [{ type: "stream-start", warnings: [] }, ...reply(o)] as never[] }) })) as never,
  });
const resolveModel = (model: MockLanguageModelV4) => async () => ({ model, provider: PROVIDERS.openai, modelId: "m1" });

const profile: Profile = {
  ...emptyProfile(),
  name: "Ana Exemplo",
  experiences: [
    { id: "exp_1", company: "Lumen Pay", title: "Frontend Sênior", startDate: "2019-01", endDate: "2023-06", bullets: [{ id: "exp_1.b1", text: "Reduziu o tempo de build em 60%" }] },
  ],
};
const summary = { kind: "summary" } as const;
const common = (model: MockLanguageModelV4) => ({ profile, target: summary, settings: defaultAiSettings(), resolveModel: resolveModel(model) });

const SENSITIVE = "Qual é a sua idade?";
const clean = ["Qual era o seu papel?", "Que tecnologias você usou?", "Qual foi o resultado?", "Quem era o time?", "Qual era o desafio?"];

describe("askQuestions", () => {
  it("pergunta sensível na 1ª resposta e nenhuma na 2ª: devolve as da 2ª", async () => {
    const model = mockModel({ questions: [SENSITIVE, clean[0], clean[1]] }, { questions: clean.slice(0, 3) });
    await expect(askQuestions(common(model))).resolves.toEqual(clean.slice(0, 3));
    expect(model.doStreamCalls).toHaveLength(2);
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("dado sensível");
  });

  it("sensível nas duas respostas e 4 limpas na 2ª: descarta só a sensível", async () => {
    const model = mockModel({ questions: [SENSITIVE, clean[0], clean[1]] }, { questions: [SENSITIVE, ...clean.slice(0, 4)] });
    await expect(askQuestions(common(model))).resolves.toEqual(clean.slice(0, 4));
  });

  it("2 limpas e 1 sensível nas duas respostas: invalid_output", async () => {
    const same = { questions: [SENSITIVE, clean[0], clean[1]] };
    const model = mockModel(same, same);
    await expect(askQuestions(common(model))).rejects.toMatchObject({ code: "invalid_output" });
  });
});

describe("writeDrafts", () => {
  const qa = [{ question: "Resultado?", answer: "Aumentei as vendas em 35%" }];
  const draft = (text: string) => ({ text, bullets: null });

  it("número inventado nas duas chamadas: invalid_output", async () => {
    const bad = { options: [draft("Aumentei a receita em 99%."), draft("Resumo sem número.")] };
    const err = await writeDrafts({ ...common(mockModel(bad, bad)), qa }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err).toMatchObject({ code: "invalid_output" });
    expect(ASSIST_INVENTED_MESSAGE).toBe("A IA sugeriu fatos que não estão no seu perfil. Tente de novo ou responda com mais detalhes.");
  });

  it("número presente nas respostas passa", async () => {
    const model = mockModel({ options: [draft("Aumentei as vendas em 35%."), draft("Cresci as vendas em 35%.")] });
    const [a] = await writeDrafts({ ...common(model), qa });
    expect(a.text).toBe("Aumentei as vendas em 35%.");
    expect(model.doStreamCalls).toHaveLength(1);
  });

  it("[NOME] na saída vira o nome do perfil", async () => {
    const model = mockModel({ options: [draft("[NOME] lidera times de frontend."), draft("Dev frontend.")] });
    const [a] = await writeDrafts({ ...common(model), qa: [] });
    expect(a.text).toBe("Ana Exemplo lidera times de frontend.");
  });

  it("bullets: valida cada bullet", async () => {
    const options = [
      { text: null, bullets: ["Reduziu o build em 60%", "Entregou 7 telas"] },
      { text: null, bullets: ["Reduziu o build em 60%"] },
    ];
    const err = await writeDrafts({ ...common(mockModel({ options }, { options })), target: { kind: "bullets", expId: "exp_1" }, qa: [] }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "invalid_output" });
  });
});

describe("rewriteDraft", () => {
  const current = { text: "Entreguei 12 projetos.", bullets: null };

  it("sourceText inclui o texto atual", async () => {
    const spy = vi.spyOn(validate, "validateAssistOutput");
    const model = mockModel({ draft: { text: "Entreguei 12 projetos com sucesso.", bullets: null } });
    const r = await rewriteDraft({ ...common(model), current, tone: { tone: "direct" } });
    expect(r.text).toBe("Entreguei 12 projetos com sucesso.");
    expect(spy.mock.calls[0][1]).toContain("Entreguei 12 projetos.");
    spy.mockRestore();
  });
});

describe("cancelamento", () => {
  it("signal abortado repassa AbortError", async () => {
    const ac = new AbortController();
    ac.abort();
    const model = mockModel({ questions: clean.slice(0, 3) });
    const err = await askQuestions({ ...common(model), signal: ac.signal }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(AiError);
    expect(err).toMatchObject({ name: "AbortError" });
  });
});
