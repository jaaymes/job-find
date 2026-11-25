import "client-only";

import { generateStructured } from "@/lib/client/ai/generate";
import { PROFILE_EXTRACT_V2 } from "@/lib/client/ai/prompts/profile.extract.v2";
import type { AiSettings } from "@/lib/client/ai/settings";
import { extractContact, redactContact } from "@/lib/client/extract/contact";
import type { Profile } from "@/lib/shared/schemas/profile";
import { normalizeSkill } from "@/lib/shared/stacks";

/** Reatribui `exp_N` e `exp_N.bM` em ordem: o modelo não é confiável para garantir unicidade. */
export function renumber(experiences: Profile["experiences"]): Profile["experiences"] {
  return experiences.map((e, i) => ({
    ...e,
    id: `exp_${i + 1}`,
    bullets: e.bullets.map((b, j) => ({ ...b, id: `exp_${i + 1}.b${j + 1}` })),
  }));
}

/**
 * Estrutura o texto de um currículo com IA (D-11). E-mail e telefone são redigidos antes do envio e
 * preenchidos localmente depois; `stackId` e os ids vêm do cliente, não do modelo.
 */
export async function importProfile(
  text: string,
  settings: AiSettings,
  signal?: AbortSignal,
  /** JSON parcial da resposta, para o progresso do modal (não confiável: só leitura com guardas). */
  onPartial?: (p: unknown) => void,
): Promise<Profile> {
  const { data } = await generateStructured({
    task: "extract",
    settings,
    system: PROFILE_EXTRACT_V2.system,
    prompt: PROFILE_EXTRACT_V2.buildUser({ cvText: redactContact(text) }),
    schema: PROFILE_EXTRACT_V2.schema,
    maxOutputTokens: PROFILE_EXTRACT_V2.maxOutputTokens,
    temperature: PROFILE_EXTRACT_V2.temperature,
    signal,
    onPartial,
  });
  return {
    ...data,
    contact: extractContact(text),
    skills: data.skills.map((s) => ({ ...s, stackId: normalizeSkill(s.name) })),
    experiences: renumber(data.experiences),
  };
}
