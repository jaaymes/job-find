import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { PROVIDERS } from "@/lib/client/ai/providers";
import type { GenerateArgs } from "@/lib/client/ai/generate";
import type { CvLang } from "@/lib/client/cv/period";
import type { TailoredDocs } from "@/lib/shared/schemas/tailored";
import type { Profile } from "@/lib/shared/schemas/profile";
import type { Pair } from "./core";

/**
 * Modelo falso do modo `--mock`: valida o encanamento (fixtures, prompt, retentativa, validador, tabela), não um modelo real.
 * `clean`: resposta fiel ao perfil. `invented-number`: 1ª resposta com um número inventado, 2ª corrigida.
 * `invalid-json`: as duas respostas são lixo. `persistent-invention`: o número inventado volta na 2ª resposta (só para testes).
 * `copied-from-job`: 1ª resposta copia da vaga a senioridade (perfil abaixo da vaga) e ferramentas ausentes do
 * perfil; a 2ª, depois do feedback do validador, volta a ser fiel. `persistent-copy`: a cópia volta na 2ª (só testes).
 */
export type MockScenario = "clean" | "invented-number" | "invalid-json" | "persistent-invention" | "copied-from-job" | "persistent-copy";

/** Pares fixos do modo mock que exercitam a retentativa, a cópia da vaga e a falha persistente. */
export const MOCK_SCENARIOS: Record<string, MockScenario> = { "07": "invented-number", "09": "invalid-json", "11": "copied-from-job" };

const LETTER: Record<CvLang, string> = {
  pt: "Tenho interesse nesta vaga e acredito que minha experiência se alinha ao que foi descrito.",
  en: "I am interested in this role and believe my experience matches what was described.",
  es: "Tengo interés en este puesto y creo que mi experiencia se alinea con lo descrito.",
};

/** Resposta fiel: reaproveita os bullets do perfil, cada um com sua fonte. */
export function faithfulDocs(pair: Pair, lang: CvLang, inventedNumber = false): TailoredDocs {
  return {
    cv: {
      headline: pair.profile.headline ?? "",
      summary: pair.profile.summary ?? "",
      skills: pair.profile.skills.map((s) => s.name),
      experiences: pair.profile.experiences.map((e, ei) => ({
        expId: e.id,
        bullets: e.bullets.map((b, bi) => ({
          text: inventedNumber && ei === 0 && bi === 0 ? `${b.text} e aumentou a receita em 87%` : b.text,
          sourceBulletIds: [b.id],
        })),
      })),
    },
    coverLetter: LETTER[lang],
  };
}

/** Resposta que copia da vaga: senioridade do título da vaga no headline e ferramentas da vaga num bullet. */
export function copiedFromJobDocs(pair: Pair, lang: CvLang): TailoredDocs {
  const docs = faithfulDocs(pair, lang);
  const [first, ...rest] = docs.cv.experiences;
  return {
    ...docs,
    cv: {
      ...docs.cv,
      headline: pair.job.title,
      experiences: first
        ? [{ ...first, bullets: first.bullets.map((b, i) => (i === 0 ? { ...b, text: `${b.text}; monitorou com Datadog e Grafana` } : b)) }, ...rest]
        : docs.cv.experiences,
    },
  };
}

const usageOf = (input: number, output: number) => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

/** `resolveModel` falso para um par. Cada par ganha o próprio modelo, com o contador de chamadas dele. */
export function mockResolverFor(pair: Pair, lang: CvLang, scenario: MockScenario): NonNullable<GenerateArgs<TailoredDocs>["resolveModel"]> {
  let call = 0;
  const model = new MockLanguageModelV4({
    doStream: async (options: { prompt: unknown }) => {
      call++;
      const copy = (scenario === "copied-from-job" && call === 1) || scenario === "persistent-copy";
      const text =
        scenario === "invalid-json"
          ? '{"cv": isto não é um JSON'
          : copy
            ? JSON.stringify(copiedFromJobDocs(pair, lang))
            : JSON.stringify(faithfulDocs(pair, lang, (scenario === "invented-number" && call === 1) || scenario === "persistent-invention"));
      const input = Math.ceil(JSON.stringify(options.prompt).length / 4);
      const chunks = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: text },
        { type: "text-end", id: "t" },
        { type: "finish", usage: usageOf(input, Math.ceil(text.length / 4)), finishReason: { unified: "stop", raw: "stop" } },
      ];
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
    },
  } as never);
  return async () => ({ model, provider: PROVIDERS.openrouter, modelId: "mock/modelo-falso" });
}

/** Opções do modelo falso da suíte `assist`: cada uma injeta um defeito que a suíte precisa pegar. */
export type AssistMockOpts = { inventedNumber?: boolean; sensitiveQuestion?: boolean };

const SUMMARY = "Pessoa desenvolvedora com experiência prática, foco em qualidade e em entregar o que o time precisa.";

/** Modelo falso do `--suite assist --mock`: responde pelo tipo de pedido (perguntas, redação ou reescrita). */
export function assistMockResolverFor(profile: Profile, opts: AssistMockOpts = {}): NonNullable<GenerateArgs<unknown>["resolveModel"]> {
  const firstBullet = profile.experiences.find((e) => e.bullets.length > 0)?.bullets[0]?.text ?? "";
  const suffix = opts.inventedNumber ? " e aumentou a conversão em 45%" : "";
  const answerFor = (prompt: string): unknown => {
    if (prompt.includes("escreva exatamente 2 opções")) {
      return { options: [SUMMARY, `${SUMMARY} Gosta de trabalhar em equipe`].map((t) => ({ text: `${t}${suffix}`, bullets: null })) };
    }
    if (prompt.includes("reescreva o texto atual")) return { draft: { text: null, bullets: [`${firstBullet}${suffix}`] } };
    return {
      questions: [
        opts.sensitiveQuestion ? "Qual é a sua idade?" : "Qual era o contexto do trabalho?",
        "O que você fez no dia a dia?",
        "Quais resultados você percebeu?",
      ],
    };
  };
  const model = new MockLanguageModelV4({
    doStream: async (options: { prompt: unknown }) => {
      const prompt = JSON.stringify(options.prompt);
      const text = JSON.stringify(answerFor(prompt));
      const input = Math.ceil(prompt.length / 4);
      const chunks = [
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "t" },
        { type: "text-delta", id: "t", delta: text },
        { type: "text-end", id: "t" },
        { type: "finish", usage: usageOf(input, Math.ceil(text.length / 4)), finishReason: { unified: "stop", raw: "stop" } },
      ];
      return { stream: simulateReadableStream({ chunks: chunks as never[] }) };
    },
  } as never);
  return async () => ({ model, provider: PROVIDERS.openrouter, modelId: "mock/modelo-falso" });
}
