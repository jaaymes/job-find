import "client-only";

import type { Profile } from "@/lib/shared/schemas/profile";
import type { TailoredDocs } from "@/lib/shared/schemas/tailored";
import { extractStacks, normalizeSkill, STACKS } from "@/lib/shared/stacks";

/**
 * Validador determinístico anti-alucinação (RN-07, camada 2). Todos os regex são lineares (sem grupos
 * aninhados ambíguos) e rodam sobre textos curtos.
 */
export type ViolationKind =
  | "unknown_exp"
  | "unknown_skill"
  | "unknown_stack"
  | "unknown_year"
  | "unknown_number"
  | "unknown_name";

export type Violation = {
  kind: ViolationKind;
  text: string;
  where: { expId?: string; bulletIndex?: number; part: "cv" | "letter" };
};

/** Contexto opcional da vaga: nomes que aparecem nela (empresa, cargo, descrição) não são "inventados". */
export type JobContext = {
  title?: string | null;
  company?: string | null;
  summary?: string | null;
  descriptionHtml?: string | null;
};

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

const STACK_LABEL = new Map(STACKS.map((s) => [s.id, s.label]));

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Números e anos
// ---------------------------------------------------------------------------

// `\d+(?:[.,]\d+)*` é linear: cada separador consome obrigatoriamente um dígito a seguir.
// O lookbehind evita dígitos colados em letras ("ES6", "S3", "i18n").
const NUMBER_RE =
  /(?<![\p{L}\d])\d+(?:[.,]\d+)*(?:(?:k|M)(?![\p{L}\d])|\s(?:mil|milh[ãa]o|milh[õo]es|mi|thousand|million)(?![\p{L}]))?(%)?/gu;

type NumToken = { raw: string; value: string; yearLike: boolean };

function canonicalNumber(raw: string): { value: string; plain: boolean } {
  const m = /^(\d+(?:[.,]\d+)*)(?:\s?(k|M|mil|milh[ãa]o|milh[õo]es|mi|thousand|million))?%?$/u.exec(raw);
  if (!m) return { value: raw, plain: false };
  const [, digits, suffix] = m;
  let n: number;
  if (/^\d{1,3}(?:\.\d{3})+$/.test(digits) || /^\d{1,3}(?:,\d{3})+$/.test(digits)) {
    n = Number(digits.replace(/[.,]/g, "")); // separador de milhar: 1.000 / 1,000
  } else {
    n = Number(digits.replace(",", ".").replace(/\.(?=.*\.)/g, ""));
  }
  if (suffix) {
    const s = suffix.toLowerCase();
    n *= s === "k" || s === "mil" || s === "thousand" ? 1000 : 1_000_000;
    if (suffix === "M") n = Number(digits.replace(",", ".")) * 1_000_000;
  }
  return { value: String(Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : raw), plain: !suffix && /^\d+$/.test(digits) };
}

function numberTokens(text: string): NumToken[] {
  const out: NumToken[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const raw = m[0];
    const { value, plain } = canonicalNumber(raw);
    const n = Number(value);
    out.push({ raw, value, yearLike: plain && !raw.endsWith("%") && raw.length === 4 && n >= 1950 && n <= 2100 });
  }
  return out;
}

function yearsIn(text: string): string[] {
  return [...text.matchAll(/(?<!\d)(?:19|20)\d{2}(?!\d)/g)].map((m) => m[0]);
}

// ---------------------------------------------------------------------------
// Nomes próprios
// ---------------------------------------------------------------------------

const COMMON_CAPITALIZED = new Set(
  [
    // meses e dias (en; em pt são minúsculos, mas podem abrir título)
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november",
    "december", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro",
    "novembro", "dezembro", "segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo",
    // pronomes e saudações
    "i", "i'm", "i've", "i'd", "i'll", "dear", "hello", "hi", "regards", "sincerely", "thanks", "best",
    "ola", "prezados", "prezado", "prezada", "caro", "cara", "atenciosamente", "cordialmente", "abraco",
    // termos genéricos de carta
    "hiring", "manager", "team", "recruiter", "recruiting", "equipe", "time", "senhor", "senhora",
    "brasil", "brazil", "remote", "remoto",
  ].map(fold),
);

// Palavras do catálogo de stacks (React, Node, Next...) ficam a cargo de `unknown_stack`.
const CATALOG_WORDS = new Set<string>();
// Só rótulos/sinônimos de uma palavra ("node.js" -> "node"): "Google Cloud" não torna "Google" conhecido.
for (const s of STACKS) {
  for (const t of [s.label, ...s.synonyms]) {
    if (/\s/.test(t.trim())) continue;
    for (const w of fold(t).split(/[^\p{L}\d]+/u)) if (w) CATALOG_WORDS.add(w);
  }
}
CATALOG_WORDS.add("next");

const WORD_RE = /[\p{L}\d][\p{L}\d'’]*/gu;

function wordSet(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(WORD_RE)) out.add(fold(m[0]));
  return out;
}

/** Palavras com inicial maiúscula fora do início de frase/linha. Siglas (tudo maiúsculo) são ignoradas. */
function capitalizedMidSentence(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\p{L}\d])\p{Lu}[\p{L}\d'’]*/gu)) {
    const word = m[0];
    if (word.length > 1 && word === word.toUpperCase()) continue; // sigla
    const before = text.slice(0, m.index);
    if (/(?:^|[.!?:;\n\r•*\-–—"“(\[]\s*)$/.test(before) || before.trim() === "") continue; // início de frase
    out.push(word);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fatos do perfil
// ---------------------------------------------------------------------------

type Facts = {
  all: string;
  numbers: Set<string>;
  years: Set<string>;
  words: Set<string>;
  stacks: Set<string>;
  skillNames: Set<string>;
};

// Apelidos curtos comuns que `normalizeSkill` não cobre como skill avulsa.
const SKILL_ALIASES: Record<string, string> = { next: "nextjs", node: "nodejs", nest: "nestjs" };

function skillId(raw: string): string | null {
  const id = normalizeSkill(raw);
  if (id) return id;
  const alias = SKILL_ALIASES[raw.trim().toLowerCase()];
  return alias && STACK_LABEL.has(alias) ? alias : null;
}

function stackIdsIn(text: string): string[] {
  return extractStacks({ title: "", body: text }).map((s) => s.id);
}

function buildFacts(profile: Profile, job?: JobContext): { profile: Facts; jobWords: Set<string> } {
  const parts: string[] = [
    profile.name ?? "",
    profile.headline ?? "",
    profile.location ?? "",
    profile.summary ?? "",
    profile.contact.email ?? "",
    ...profile.contact.links,
    ...profile.skills.flatMap((s) => [s.name, s.years == null ? "" : String(s.years)]),
    ...profile.experiences.flatMap((e) => [e.company, e.title, e.startDate ?? "", e.endDate ?? "", ...e.bullets.map((b) => b.text)]),
    ...profile.education.flatMap((e) => [e.institution, e.degree ?? "", e.startYear ?? "", e.endYear ?? ""]),
  ];
  const all = parts.join("\n");
  const stacks = new Set<string>(stackIdsIn(all));
  const skillNames = new Set<string>();
  for (const s of profile.skills) {
    skillNames.add(fold(s.name.trim()));
    if (s.stackId) stacks.add(s.stackId);
    const id = normalizeSkill(s.name);
    if (id) stacks.add(id);
    for (const x of extractStacks({ title: s.name })) stacks.add(x.id);
  }
  const jobText = [job?.title, job?.company, job?.summary, job?.descriptionHtml ? stripHtml(job.descriptionHtml) : ""]
    .filter(Boolean)
    .join("\n");
  return {
    profile: {
      all,
      numbers: new Set(numberTokens(all).map((t) => t.value)),
      years: new Set(yearsIn(all)),
      words: wordSet(all),
      stacks,
      skillNames,
    },
    jobWords: wordSet(jobText),
  };
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

type Where = Violation["where"];

/**
 * @param profile perfil local do usuário (fonte de verdade).
 * @param docs saída do modelo.
 * @param job contexto opcional da vaga (3º parâmetro, compatível com a assinatura do brief): empresa, cargo
 *   e nomes da descrição não geram `unknown_name`.
 *
 * Escolhas documentadas:
 * - `expId` ausente do perfil, ou repetido em `cv.experiences` (a repetição só vale a 1ª vez), gera `unknown_exp`;
 *   na repetição `where` leva só `expId` (sem `bulletIndex`), e `flagBullets` marca todos os bullets daquele `expId`.
 * - `sourceBulletIds` inexistente, de OUTRA experiência ou vazio gera `unknown_exp` com `text` = o id (ou
 *   "sem fonte") e `where.bulletIndex` preenchido. Só os textos de origem válidos entram na comparação de números.
 * - Stacks, anos e nomes de bullets são comparados com o perfil inteiro; números, só com as fontes válidas.
 *   Headline, summary e carta são comparados com o perfil inteiro, inclusive números.
 */
export function validateTailored(profile: Profile, docs: TailoredDocs, job?: JobContext): Violation[] {
  const { profile: facts, jobWords } = buildFacts(profile, job);
  const out: Violation[] = [];
  const seen = new Set<string>();
  const add = (kind: ViolationKind, text: string, where: Where) => {
    const key = `${kind}|${text}|${where.part}|${where.expId ?? ""}|${where.bulletIndex ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, text, where });
  };

  const checkText = (text: string, where: Where, sourceNumbers: Set<string>) => {
    for (const t of numberTokens(text)) {
      if (t.yearLike) {
        if (!facts.years.has(t.raw) && !sourceNumbers.has(t.value)) add("unknown_year", t.raw, where);
      } else if (!sourceNumbers.has(t.value)) {
        add("unknown_number", t.raw, where);
      }
    }
    for (const id of stackIdsIn(text)) {
      if (!facts.stacks.has(id)) add("unknown_stack", STACK_LABEL.get(id) ?? id, where);
    }
    for (const w of capitalizedMidSentence(text)) {
      const f = fold(w);
      if (COMMON_CAPITALIZED.has(f) || CATALOG_WORDS.has(f) || facts.words.has(f) || jobWords.has(f)) continue;
      add("unknown_name", w, where);
    }
  };

  const wholeProfileNumbers = facts.numbers;
  const cvWhere: Where = { part: "cv" };

  // skills
  for (const skill of docs.cv.skills) {
    const id = skillId(skill);
    const ok = id ? facts.stacks.has(id) : facts.skillNames.has(fold(skill.trim()));
    if (!ok) add("unknown_skill", skill, cvWhere);
  }
  checkText(docs.cv.headline, cvWhere, wholeProfileNumbers);
  checkText(docs.cv.summary, cvWhere, wholeProfileNumbers);

  // experiências e bullets
  const bulletById = new Map<string, { expId: string; text: string }>();
  const expIds = new Set<string>();
  for (const e of profile.experiences) {
    expIds.add(e.id);
    for (const b of e.bullets) bulletById.set(b.id, { expId: e.id, text: b.text });
  }
  const used = new Set<string>();
  for (const x of docs.cv.experiences) {
    const known = expIds.has(x.expId);
    if (!known) add("unknown_exp", x.expId, { expId: x.expId, part: "cv" });
    else if (used.has(x.expId)) add("unknown_exp", x.expId, { expId: x.expId, part: "cv" });
    used.add(x.expId);
    x.bullets.forEach((b, bulletIndex) => {
      const where: Where = { expId: x.expId, bulletIndex, part: "cv" };
      const sources: string[] = [];
      for (const id of b.sourceBulletIds) {
        const src = bulletById.get(id);
        if (!src || src.expId !== x.expId) add("unknown_exp", id, where);
        else sources.push(src.text);
      }
      if (b.sourceBulletIds.length === 0) add("unknown_exp", "sem fonte", where);
      checkText(b.text, where, new Set(sources.flatMap((s) => numberTokens(s).map((t) => t.value))));
    });
  }

  if (docs.coverLetter) checkText(docs.coverLetter, { part: "letter" }, wholeProfileNumbers);
  return out;
}

// ---------------------------------------------------------------------------
// Feedback para o modelo
// ---------------------------------------------------------------------------

function locus(w: Where): string {
  if (w.part === "letter") return "na carta";
  if (w.expId !== undefined && w.bulletIndex !== undefined) return `no bullet ${w.bulletIndex + 1} de ${w.expId}`;
  if (w.expId !== undefined) return `em ${w.expId}`;
  return "no CV";
}

/** Mensagens curtas, em pt-BR, para o `validate` do `generateStructured` (retentativa única). */
export function toPromptFeedback(violations: Violation[]): string[] {
  return violations.map((v) => {
    const at = locus(v.where);
    switch (v.kind) {
      case "unknown_exp":
        return v.text === "sem fonte"
          ? `${at}: o bullet não tem sourceBulletIds; cite os ids do perfil que o sustentam ou remova o bullet`
          : `${at}: "${v.text}" não é um expId nem um sourceBulletId válido desta experiência do perfil; use só ids existentes, sem repetir experiências`;
      case "unknown_skill":
        return `${at}: a skill "${v.text}" não está no perfil; remova-a`;
      case "unknown_stack":
        return `${at}: a tecnologia "${v.text}" não aparece no perfil; remova a menção`;
      case "unknown_year":
        return `${at}: o ano ${v.text} não aparece no perfil; remova-o ou use só anos do perfil`;
      case "unknown_number":
        return `${at}: o número "${v.text}" não está no texto de origem; remova-o ou use só números do perfil`;
      case "unknown_name":
        return `${at}: o nome "${v.text}" não aparece no perfil nem na vaga; remova-o`;
    }
  });
}
