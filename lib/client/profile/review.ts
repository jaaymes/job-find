import { extractStacks, normalizeSkill, STACKS } from "@/lib/shared/stacks";
import type { Profile } from "@/lib/shared/schemas/profile";

/** Revisão determinística do perfil (D-09) e sugestão de skills (D-10): sem IA e sem rede. */

export type Finding = {
  kind: "bullet_no_verb" | "bullet_long" | "summary_long" | "skill_missing";
  where:
    | { field: "summary" }
    | { field: "bullet"; expId: string; bulletId: string }
    | { field: "skills"; stackId: string };
  message: string;
};

export const BULLET_MAX_CHARS = 200;
export const SUMMARY_MAX_CHARS = 600;

/** Verbos de ação (minúsculos): infinitivo, passado em 1ª e 3ª pessoa (pt) e passado (en). */
const ACTION_VERBS = new Set([
  // pt: infinitivo
  "desenvolver", "liderar", "implementar", "reduzir", "criar", "otimizar", "migrar", "automatizar", "projetar", "gerenciar",
  // pt: 1ª pessoa
  "desenvolvi", "liderei", "implementei", "reduzi", "criei", "otimizei", "migrei", "automatizei", "projetei", "gerenciei",
  "construí", "conduzi", "escrevi", "coordenei", "aumentei", "entreguei", "estruturei", "integrei", "mantive",
  "lancei", "planejei", "testei", "treinei", "mentorei", "atuei", "participei", "colaborei", "analisei", "elaborei",
  // pt: 3ª pessoa (as terminações -ou e -iu já cobrem a maioria; estas são irregulares)
  "construiu", "conduziu", "escreveu", "mantém", "manteve", "deu", "viu", "pôs",
  // en: passado
  "built", "led", "developed", "implemented", "reduced", "created", "designed", "managed", "improved", "increased",
  "delivered", "launched", "wrote", "ran", "drove", "shipped", "owned", "optimized", "automated", "migrated",
  "architected", "mentored", "analyzed", "integrated", "maintained", "scaled", "refactored", "deployed", "established", "set",
]);
const VERB_ENDING = /(ei|ou|iu|amos|emos|imos|ed|ing)$/;

function firstWord(text: string): string {
  const m = /[\p{L}]+/u.exec(text);
  return m ? m[0].toLowerCase() : "";
}

function hasActionVerb(text: string): boolean {
  const w = firstWord(text);
  return ACTION_VERBS.has(w) || VERB_ENDING.test(w);
}

const snippet = (t: string) => (t.length > 50 ? `${t.slice(0, 50).trimEnd()}…` : t);

function bulletTexts(profile: Profile): string[] {
  return [...profile.experiences, ...profile.projects].flatMap((x) => x.bullets.map((b) => b.text));
}

export function suggestSkills(profile: Profile): { stackId: string; label: string }[] {
  const have = new Set<string>();
  for (const s of profile.skills) {
    const id = s.stackId ?? normalizeSkill(s.name);
    if (id) have.add(id);
  }
  const labels = new Map(STACKS.map((s) => [s.id, s.label]));
  const out = new Map<string, string>();
  for (const text of bulletTexts(profile)) {
    for (const { id } of extractStacks({ title: "", body: text })) {
      if (!have.has(id) && !out.has(id)) out.set(id, labels.get(id) ?? id);
    }
  }
  return [...out].map(([stackId, label]) => ({ stackId, label }));
}

export function reviewProfile(profile: Profile): Finding[] {
  const out: Finding[] = [];
  if ((profile.summary ?? "").length > SUMMARY_MAX_CHARS) {
    out.push({
      kind: "summary_long",
      where: { field: "summary" },
      message: `O resumo tem mais de ${SUMMARY_MAX_CHARS} caracteres. Resumos curtos são lidos até o fim.`,
    });
  }
  for (const exp of profile.experiences) {
    for (const b of exp.bullets) {
      const text = b.text.trim();
      if (!text) continue;
      const where = { field: "bullet", expId: exp.id, bulletId: b.id } as const;
      if (!hasActionVerb(text)) {
        out.push({ kind: "bullet_no_verb", where, message: `“${snippet(text)}” não começa com um verbo de ação.` });
      }
      if (text.length > BULLET_MAX_CHARS) {
        out.push({
          kind: "bullet_long",
          where,
          message: `“${snippet(text)}” passa de ${BULLET_MAX_CHARS} caracteres (cerca de 2 linhas no PDF).`,
        });
      }
    }
  }
  for (const s of suggestSkills(profile)) {
    out.push({
      kind: "skill_missing",
      where: { field: "skills", stackId: s.stackId },
      message: `${s.label} aparece ou está implícita nas suas realizações, mas não está nas competências.`,
    });
  }
  return out;
}
