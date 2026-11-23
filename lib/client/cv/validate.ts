import "client-only";

import type { Profile } from "@/lib/shared/schemas/profile";
import type { TailoredDocs } from "@/lib/shared/schemas/tailored";
import { SENIORITY_LABEL } from "@/lib/shared/schemas/profile";
import { extractStacks, normalizeSkill, STACKS } from "@/lib/shared/stacks";
import { bulletKey, experienceKey, headlineKey, letterKey, skillKey, summaryKey } from "./flags";

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
  /** Chave estável do trecho (ver `flags.ts`): é o que "Aprovar mesmo assim" grava em `approvedFlags`. */
  key: string;
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
    "novembro", "dezembro", "jan", "fev", "feb", "mar", "abr", "apr", "mai", "jun", "jul", "ago", "aug", "set",
    "sep", "sept", "out", "oct", "nov", "dez", "dec", "segunda", "terca", "quarta", "quinta", "sexta", "sabado", "domingo",
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

const SENTENCE_END = new Set([".", "!", "?", ":", ";", "•", "*", "-", "–", "—", '"', "“", "(", "["]);

/**
 * Palavras com inicial maiúscula fora do início de frase/linha. Siglas (tudo maiúsculo) são ignoradas aqui.
 * Para decidir o início de frase anda para trás só sobre o espaço em branco entre duas palavras (O(n) no total).
 */
function capitalizedMidSentence(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![\p{L}\d])\p{Lu}[\p{L}\d'’]*/gu)) {
    const word = m[0];
    if (word.length > 1 && word === word.toUpperCase()) continue; // sigla
    let i = m.index - 1;
    let newline = false;
    while (i >= 0 && /\s/.test(text[i])) {
      if (text[i] === "\n" || text[i] === "\r") newline = true;
      i--;
    }
    if (i < 0 || newline || SENTENCE_END.has(text[i])) continue; // início de frase
    out.push(word);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Senioridade/cargo, certificações/formação, números por extenso, siglas e empresas
// ---------------------------------------------------------------------------

// Grupos de termos equivalentes (já dobrados: sem acento, minúsculos). Um grupo vale se QUALQUER termo dele
// aparece na fonte. Os cargos/senioridades valem também se aparecem na vaga.
const SENIORITY_GROUPS = [
  ["junior"], ["pleno", "mid-level", "mid level", "midlevel"], ["senior"], ["staff"], ["principal"],
  ["tech lead", "lead", "lider"], ["head"], ["manager", "gerente"], ["coordenador", "coordenadora", "coordinator"],
  ["architect", "arquiteto", "arquiteta"], ["director", "diretor", "diretora"], ["cto"], ["vp"],
];
const CREDENTIAL_GROUPS = [
  ["certified", "certification", "certifications", "certificate", "certificacao", "certificacoes", "certificado",
    "certificada", "certificados", "certificadas"],
  ["pmp"], ["csm"], ["mba"], ["mestrado", "master's", "msc"], ["doutorado", "phd"],
  ["bacharel", "bacharelado", "bachelor", "bachelor's"], ["pos-graduacao", "pos graduacao", "posgraduacao"],
];
// "um/uma/one/a" ficam de fora (artigos). Limitação: "dois anos" só passa se "dois" está na fonte (não equivale a "2").
const WRITTEN_NUMBERS = [
  "dois", "duas", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze",
  "catorze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove", "vinte", "cem", "cento", "mil",
  "milhao", "milhoes", "dobrei", "dobrou", "dobramos", "triplicou", "triplicamos", "metade",
  "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
  "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "hundred", "hundreds",
  "thousand", "thousands", "million", "millions", "half", "double", "doubled", "tripled", "triple",
];
const ACRONYM_ALLOWLIST = new Set(
  ["api", "rest", "ci", "cd", "ui", "ux", "sql", "http", "https", "json", "saas", "b2b", "b2c", "mvp", "kpi", "okr", "qa",
    "tdd", "bdd", "sla", "sdk", "cli", "orm", "spa", "ssr", "pwa", "seo", "it", "ti", "rh", "hr", "cv", "pdf", "usa",
    "eua", "br", "en", "pt", "ok", "pr", "url", "html", "css"],
);
// Empresas conhecidas, para pegar nomes em minúsculas ("na google"). Sem palavras comuns (meta, stone, vale).
const KNOWN_COMPANIES = [
  "google", "itau", "nubank", "amazon", "microsoft", "facebook", "oracle", "netflix", "uber", "spotify", "bradesco",
  "santander", "btg", "ifood", "magalu", "americanas", "petrobras", "embraer", "totvs", "stefanini", "accenture",
  "thoughtworks", "deloitte", "linkedin", "twitter", "salesforce", "ibm", "tesla", "airbnb", "shopify",
];

function esc(t: string): string {
  return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function termRegex(terms: string[]): RegExp {
  const alt = [...terms].sort((a, b) => b.length - a.length).map(esc).join("|");
  return new RegExp(`(?<![\\p{L}\\d])(?:${alt})(?![\\p{L}\\d])`, "gu");
}
const SENIORITY_RES = SENIORITY_GROUPS.map(termRegex);
const CREDENTIAL_RES = CREDENTIAL_GROUPS.map(termRegex);
const WRITTEN_RE = termRegex(WRITTEN_NUMBERS);
const COMPANY_RE = termRegex(KNOWN_COMPANIES);
const ACRONYM_RE = /(?<![\p{L}\d])\p{Lu}[\p{Lu}\d]*\p{Lu}s?(?![\p{L}\d])/gu;

/** Texto dobrado para busca de termos: sem acento, minúsculo, aspas tipográficas normalizadas. */
function foldText(s: string): string {
  return fold(s).replace(/[’‘]/g, "'");
}

function groupsHit(folded: string, res: RegExp[]): Set<number> {
  const out = new Set<number>();
  res.forEach((re, i) => {
    re.lastIndex = 0;
    if (re.test(folded)) out.add(i);
  });
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
  /** Grupos de senioridade/cargo presentes no perfil ou na vaga. */
  seniorityOk: Set<number>;
  /** Grupos de certificação/formação presentes no perfil. */
  credentialOk: Set<number>;
  /** Texto do perfil dobrado (para checar números por extenso). */
  folded: string;
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
  if (profile.seniority) parts.push(profile.seniority, SENIORITY_LABEL[profile.seniority]);
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
  const folded = foldText(all);
  const jobFolded = foldText(jobText);
  const seniorityOk = groupsHit(`${folded}\n${jobFolded}`, SENIORITY_RES);
  const years = new Set(yearsIn(all));
  // Experiência atual (endDate null): o ano corrente é um ano válido ("2021–2026").
  if (profile.experiences.some((e) => e.endDate === null)) years.add(String(new Date().getFullYear()));
  return {
    profile: {
      all,
      numbers: new Set(numberTokens(all).map((t) => t.value)),
      years,
      seniorityOk,
      credentialOk: groupsHit(folded, CREDENTIAL_RES),
      folded,
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
 * - `expId` ausente do perfil, ou repetido em `cv.experiences` (a repetição só vale a 1ª vez), gera `unknown_exp`
 *   de nível de experiência (`where` só com `expId`; `key` = `experienceKey(expId, ocorrência)`); `flagBullets`
 *   marca todos os bullets dessa ocorrência e a violação não é aprovável.
 * - Cargo/senioridade ausente do perfil e da vaga, certificação/formação ausente do perfil, sigla desconhecida,
 *   empresa conhecida em minúsculas e número por extenso ausente da fonte geram `unknown_name` (ou
 *   `unknown_number` para números por extenso). Limitação: a lista de empresas é curta e "dois" não equivale a "2".
 * - Toda violação traz `key` (trecho + hash do texto); ver `flags.ts`.
 * - `sourceBulletIds` inexistente, de OUTRA experiência ou vazio gera `unknown_exp` com `text` = o id (ou
 *   "sem fonte") e `where.bulletIndex` preenchido. Só os textos de origem válidos entram na comparação de números.
 * - Stacks, anos e nomes de bullets são comparados com o perfil inteiro; números, só com as fontes válidas.
 *   Headline, summary e carta são comparados com o perfil inteiro, inclusive números.
 */
export function validateTailored(profile: Profile, docs: TailoredDocs, job?: JobContext): Violation[] {
  const { profile: facts, jobWords } = buildFacts(profile, job);
  const out: Violation[] = [];
  const seen = new Set<string>();
  const add = (kind: ViolationKind, text: string, where: Where, key: string) => {
    const id = `${kind}|${text}|${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ kind, text, where, key });
  };

  /** `sourceText`: texto cujos números/termos por extenso valem para este trecho. */
  const checkText = (text: string, where: Where, key: string, sourceText: string) => {
    const sourceNumbers = new Set(numberTokens(sourceText).map((t) => t.value));
    for (const t of numberTokens(text)) {
      if (t.yearLike) {
        if (!facts.years.has(t.raw) && !sourceNumbers.has(t.value)) add("unknown_year", t.raw, where, key);
      } else if (!sourceNumbers.has(t.value)) {
        add("unknown_number", t.raw, where, key);
      }
    }
    for (const id of stackIdsIn(text)) {
      if (!facts.stacks.has(id)) add("unknown_stack", STACK_LABEL.get(id) ?? id, where, key);
    }
    const flaggedNames = new Set<string>();
    const flagName = (w: string) => {
      flaggedNames.add(fold(w));
      add("unknown_name", w, where, key);
    };
    const folded = foldText(text).replace(/hiring manager/g, " ");

    // Senioridade/cargo (perfil ou vaga) e certificação/formação (só perfil).
    SENIORITY_RES.forEach((re, i) => {
      re.lastIndex = 0;
      const m = re.exec(folded);
      if (m && !facts.seniorityOk.has(i)) flagName(m[0]);
    });
    CREDENTIAL_RES.forEach((re, i) => {
      re.lastIndex = 0;
      const m = re.exec(folded);
      if (m && !facts.credentialOk.has(i)) flagName(m[0]);
    });

    // Números por extenso, fora dos trechos já lidos como numerais ("1,5 mil"); valem se estão na fonte.
    const noDigits = foldText(text).replace(NUMBER_RE, " ");
    const sourceFolded = foldText(sourceText);
    WRITTEN_RE.lastIndex = 0;
    for (const m of noDigits.matchAll(WRITTEN_RE)) {
      const re = new RegExp(`(?<![\\p{L}\\d])${esc(m[0])}(?![\\p{L}\\d])`, "u");
      if (!re.test(sourceFolded)) add("unknown_number", m[0], where, key);
    }

    for (const w of capitalizedMidSentence(text)) {
      const f = fold(w);
      if (COMMON_CAPITALIZED.has(f) || CATALOG_WORDS.has(f) || facts.words.has(f) || jobWords.has(f) || flaggedNames.has(f)) continue;
      flagName(w);
    }

    // Empresas conhecidas em minúsculas.
    for (const m of folded.matchAll(COMPANY_RE)) {
      if (!facts.words.has(m[0]) && !jobWords.has(m[0]) && !flaggedNames.has(m[0])) flagName(m[0]);
    }

    // Siglas desconhecidas (fora do perfil, da vaga, do catálogo e da lista de siglas comuns).
    for (const m of text.matchAll(ACRONYM_RE)) {
      const f = fold(m[0]);
      const base = f.endsWith("s") ? f.slice(0, -1) : f;
      const known = (x: string) => ACRONYM_ALLOWLIST.has(x) || CATALOG_WORDS.has(x) || facts.words.has(x) || jobWords.has(x);
      if (known(f) || known(base) || flaggedNames.has(f)) continue;
      flagName(m[0]);
    }
  };

  const cvWhere: Where = { part: "cv" };

  // skills
  docs.cv.skills.forEach((skill, i) => {
    const id = skillId(skill);
    const ok = id ? facts.stacks.has(id) : facts.skillNames.has(fold(skill.trim()));
    if (!ok) add("unknown_skill", skill, cvWhere, skillKey(i, skill));
  });
  checkText(docs.cv.headline, cvWhere, headlineKey(docs.cv.headline), facts.all);
  checkText(docs.cv.summary, cvWhere, summaryKey(docs.cv.summary), facts.all);

  // experiências e bullets
  const bulletById = new Map<string, { expId: string; text: string }>();
  const expIds = new Set<string>();
  for (const e of profile.experiences) {
    expIds.add(e.id);
    for (const b of e.bullets) bulletById.set(b.id, { expId: e.id, text: b.text });
  }
  const occurrences = new Map<string, number>();
  for (const x of docs.cv.experiences) {
    const occurrence = occurrences.get(x.expId) ?? 0;
    occurrences.set(x.expId, occurrence + 1);
    // Experiência desconhecida ou repetida: violação de nível de experiência (não aprovável em `flagBullets`).
    if (!expIds.has(x.expId) || occurrence > 0) {
      add("unknown_exp", x.expId, { expId: x.expId, part: "cv" }, experienceKey(x.expId, occurrence));
    }
    x.bullets.forEach((b, bulletIndex) => {
      const where: Where = { expId: x.expId, bulletIndex, part: "cv" };
      const key = bulletKey(x.expId, occurrence, bulletIndex, b.text);
      const sources: string[] = [];
      for (const id of b.sourceBulletIds) {
        const src = bulletById.get(id);
        if (!src || src.expId !== x.expId) add("unknown_exp", id, where, key);
        else sources.push(src.text);
      }
      if (b.sourceBulletIds.length === 0) add("unknown_exp", "sem fonte", where, key);
      checkText(b.text, where, key, sources.join("\n"));
    });
  }

  if (docs.coverLetter) checkText(docs.coverLetter, { part: "letter" }, letterKey(docs.coverLetter), facts.all);
  return out;
}

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
        return v.where.bulletIndex !== undefined
          ? `${at}: o número "${v.text}" não está na fonte citada; use só números do bullet de origem (sourceBulletIds) ou remova-o`
          : `${at}: o número "${v.text}" não está no perfil; remova-o ou use só números do perfil`;
      case "unknown_name":
        return `${at}: o termo "${v.text}" (nome, sigla, cargo, senioridade ou certificação) não aparece no perfil nem na vaga; remova-o`;
    }
  });
}
