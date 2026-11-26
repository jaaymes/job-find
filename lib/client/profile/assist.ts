import "client-only";

import { generateStructured, type GenerateArgs } from "@/lib/client/ai/generate";
import {
  ASSIST_QUESTIONS_V1,
  ASSIST_REWRITE_V1,
  ASSIST_WRITE_V1,
  sensitiveQuestion,
  type AssistTarget,
  type AssistTone,
  type Draft,
} from "@/lib/client/ai/prompts/profile.assist.v1";
import type { AiSettings } from "@/lib/client/ai/settings";
import { toPromptFeedback, validateAssistOutput } from "@/lib/client/cv/validate";
import type { Profile } from "@/lib/shared/schemas/profile";

/** Mensagem do RN-20 quando a IA ainda sugere fatos fora do perfil depois das 2 chamadas (D-04). */
export const ASSIST_INVENTED_MESSAGE = "A IA sugeriu fatos que não estão no seu perfil. Tente de novo ou responda com mais detalhes.";

/** Mínimo de perguntas que precisa sobrar depois de descartar as sensíveis (D-05). */
const MIN_QUESTIONS = 3;

type Common = {
  profile: Profile;
  target: AssistTarget;
  settings: AiSettings;
  signal?: AbortSignal;
  onPartial?: (p: unknown) => void;
  resolveModel?: GenerateArgs<unknown>["resolveModel"];
};

const base = (a: Common) => ({
  task: "cv" as const,
  settings: a.settings,
  signal: a.signal,
  onPartial: a.onPartial,
  resolveModel: a.resolveModel,
});

/** O modelo às vezes escreve `[NOME]`, o marcador do nome ocultado no prompt: volta para o nome do perfil. */
export function restoreName(profile: Profile, d: Draft): Draft {
  const name = profile.name?.trim();
  if (!name) return d;
  const fix = (s: string) => s.replaceAll("[NOME]", name);
  return { text: d.text === null ? null : fix(d.text), bullets: d.bullets === null ? null : d.bullets.map(fix) };
}

/** Campo que o alvo exige: `text` para título e resumo, `bullets` para a lista de uma experiência. */
function draftTexts(target: AssistTarget, d: Draft): string[] | string {
  if (target.kind === "bullets") {
    const bullets = (d.bullets ?? []).filter((b) => b.trim());
    return bullets.length > 0 ? bullets : "o rascunho precisa trazer bullets (campo bullets) e deixar text null";
  }
  const text = d.text?.trim();
  return text ? [text] : "o rascunho precisa trazer o campo text preenchido e deixar bullets null";
}

function validateDraft(profile: Profile, target: AssistTarget, sourceText: string, d: Draft): string[] {
  const fixed = restoreName(profile, d);
  const texts = draftTexts(target, fixed);
  if (typeof texts === "string") return [texts];
  return toPromptFeedback(validateAssistOutput(profile, sourceText, texts));
}

/** Chamada (prompt, schema e limites) das perguntas, sem o `validate`: o eval a reaproveita para medir o modelo cru. */
export const questionsCall = (a: Common) => ({
  ...base(a),
  system: ASSIST_QUESTIONS_V1.system,
  prompt: ASSIST_QUESTIONS_V1.buildUser({ profile: a.profile, target: a.target }),
  schema: ASSIST_QUESTIONS_V1.schema,
  maxOutputTokens: ASSIST_QUESTIONS_V1.maxOutputTokens,
  temperature: ASSIST_QUESTIONS_V1.temperature,
});

/** RF-21: 3 a 5 perguntas para a entrevista. Pergunta sensível (RN-22) reprova a 1ª chamada; na última é descartada. */
export async function askQuestions(a: Common): Promise<string[]> {
  const { data } = await generateStructured({
    ...questionsCall(a),
    validate: (v, ctx) => {
      if (v.questions.every((q) => !q.trim())) return ["as perguntas vieram vazias; faça de 3 a 5 perguntas sobre o trabalho"];
      const bad = v.questions.filter(sensitiveQuestion);
      if (bad.length === 0) return [];
      // Na última chamada, descartar só as sensíveis basta se sobrarem perguntas suficientes.
      if (ctx.last && v.questions.filter((q) => q.trim()).length - bad.length >= MIN_QUESTIONS) return [];
      return bad.map((q) => `a pergunta "${q}" toca em dado sensível; troque por uma pergunta sobre o trabalho, as tecnologias ou os resultados`);
    },
  });
  return data.questions.filter((q) => q.trim() && !sensitiveQuestion(q));
}

/** Chamada das 2 opções de texto, sem o `validate` (ver `questionsCall`). */
export const writeCall = (a: Common & { qa: { question: string; answer: string }[] }) => ({
  ...base(a),
  system: ASSIST_WRITE_V1.system,
  prompt: ASSIST_WRITE_V1.buildUser({ profile: a.profile, target: a.target, qa: a.qa }),
  schema: ASSIST_WRITE_V1.schema,
  maxOutputTokens: ASSIST_WRITE_V1.maxOutputTokens,
  temperature: ASSIST_WRITE_V1.temperature,
});

/** RF-21: 2 opções de texto a partir do perfil e das respostas, com o RN-20 aplicado nas duas. */
export async function writeDrafts(a: Common & { qa: { question: string; answer: string }[] }): Promise<[Draft, Draft]> {
  const sourceText = a.qa.map((x) => x.answer).join("\n");
  const { data } = await generateStructured({
    ...writeCall(a),
    validate: (v) => v.options.flatMap((d) => validateDraft(a.profile, a.target, sourceText, d)),
  });
  const [x, y] = data.options;
  return [restoreName(a.profile, x), restoreName(a.profile, y)];
}

const draftSource = (d: Draft): string => (d.bullets ? d.bullets.join("\n") : (d.text ?? ""));

/** Chamada da reescrita, sem o `validate` (ver `questionsCall`). */
export const rewriteCall = (a: Common & { current: Draft; tone: AssistTone }) => ({
  ...base(a),
  system: ASSIST_REWRITE_V1.system,
  prompt: ASSIST_REWRITE_V1.buildUser({ profile: a.profile, target: a.target, current: a.current, tone: a.tone }),
  schema: ASSIST_REWRITE_V1.schema,
  maxOutputTokens: ASSIST_REWRITE_V1.maxOutputTokens,
  temperature: ASSIST_REWRITE_V1.temperature,
});

/** RF-22: reescreve o texto atual no tom pedido. O texto atual é fonte de fatos; "Traduzir" compara nomes sem caixa. */
export async function rewriteDraft(a: Common & { current: Draft; tone: AssistTone }): Promise<Draft> {
  const sourceText = draftSource(a.current);
  const { data } = await generateStructured({
    ...rewriteCall(a),
    validate: (v) => validateDraft(a.profile, a.target, sourceText, v.draft),
  });
  return restoreName(a.profile, data.draft);
}
