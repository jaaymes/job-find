import "client-only";

import type { Profile } from "@/lib/shared/schemas/profile";
import type { TailoredDocs } from "@/lib/shared/schemas/tailored";
import { SENIORITY_LABEL } from "@/lib/shared/schemas/profile";
import { extractStacks, normalizeSkill, STACKS } from "@/lib/shared/stacks";
import { textHash, bulletKey, experienceKey, headlineKey, letterKey, skillKey, summaryKey } from "./flags";

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

/** Contexto opcional da vaga: nomes que aparecem nela (empresa, cargo, descrição) não são "inventados" NA CARTA. */
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
    // Só o último ponto é decimal. (Um lookahead `/\.(?=.*\.)/g` seria quadrático num token "1.1.1.1…" enorme.)
    const dec = digits.replace(",", ".");
    const last = dec.lastIndexOf(".");
    n = Number(last < 0 ? dec : dec.slice(0, last).replaceAll(".", "") + dec.slice(last));
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
    out.push({ raw, value, yearLike: plain && !raw.endsWith("%") && raw.length === 4 && n >= 1900 && n <= 2099 });
  }
  return out;
}

const MONTH_AFTER =
  /^(?:jan|fev|feb|mar|abr|apr|mai|may|jun|jul|ago|aug|set|sep|out|oct|nov|dez|dec|janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro|january|february|march|april|june|july|august|september|october|november|december)\b/iu;
// Para quantidades: "de" sozinho ("plataforma de 2000 usuários") é ambíguo e não conta; "de 2015 a 2017" cai no RANGE_AFTER.
const DATE_BEFORE_STRICT = /(?:^|[^\p{L}])(?:em|in|desde|since|até|ate|until|from|en|hasta)\s+$/iu;
const AMOUNT_BEFORE = /(?:mais|menos|cerca|quase|over|than|about|around|nearly|más|casi)\s+(?:de|of)?\s*$/iu;
const RANGE_AFTER = /^\s*(?:[-–—]|a\b|à\b|até\b|to\b|and\b|e(?=\s|$)|hasta\b|y\b)/iu;

/** Palavra que vem logo depois de `raw` em `text`, sem acento e sem caixa (ou `null` se não houver). */
function wordAfter(text: string, end: number): string | null {
  const w = /^\s+(\p{L}[\p{L}\p{N}]*)/u.exec(text.slice(end));
  return w ? fold(w[1]) : null;
}

/**
 * `raw` (número de 4 dígitos que não está no perfil) é uma quantidade dita pelo usuário? Vale quando TODA ocorrência
 * no texto gerado tem uma palavra depois, que não é mês, sem preposição de data antes, sem cara de intervalo, e o par
 * "número + palavra" aparece igual nas respostas ("2000 usuários"). Qualquer outra posição ("Durante 2019...",
 * "2019 marcou...") ou par diferente é tratado como data inventada.
 */
function typedQuantity(text: string, sourceText: string, raw: string): boolean {
  const re = new RegExp(`(?<![\\d.,])${raw}(?![\\d]|[.,]\\d)`, "g");
  // Só vale como fonte a ocorrência que também é quantidade: "em 2019 entreguei" nas respostas é uma data.
  const quantityWord = (t: string, index: number): string | null => {
    const before = t.slice(0, index);
    const after = t.slice(index + raw.length);
    if (DATE_BEFORE_STRICT.test(before) && !AMOUNT_BEFORE.test(before)) return null;
    if (RANGE_AFTER.test(after)) return null;
    const w = wordAfter(t, index + raw.length);
    return !w || MONTH_AFTER.test(w) ? null : w;
  };
  const sourcePairs = new Set<string>();
  for (const m of sourceText.matchAll(re)) {
    const w = quantityWord(sourceText, m.index);
    if (w) sourcePairs.add(w);
  }
  let found = false;
  for (const m of text.matchAll(re)) {
    found = true;
    const w = quantityWord(text, m.index);
    if (!w || !sourcePairs.has(w)) return false;
  }
  return found;
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
// Cargos e áreas comuns em títulos (en/es). Senioridade (Senior, Staff, Lead...) fica de fora: tem checagem própria.
// São "comuns" só FORA de contexto de empresa: "at Cloud Data Software" é um nome de empresa (ver `companyRunStarts`).
const COMMON_ROLE_WORDS = new Set(
  [
    "developer", "engineer", "software", "frontend", "front-end", "backend", "back-end", "full", "stack", "fullstack",
    "full-stack", "mobile", "web", "platform", "data", "cloud", "devops", "product", "designer", "analyst",
    "consultant", "specialist", "programmer", "architect", "engineering", "development",
    "desarrollador", "desarrolladora", "ingeniero", "ingeniera", "analista",
  ].map(fold),
);
for (const w of COMMON_ROLE_WORDS) COMMON_CAPITALIZED.add(w);

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
// Sequência de palavras com inicial maiúscula logo depois de uma preposição de empresa ("at Cloud Data Software",
// "na Data Software"). Linear: cada repetição consome espaço e uma maiúscula. Sem "em"/"for": "Especialista em
// Frontend", "apps for Mobile" descrevem área, não empresa.
const COMPANY_RUN_RE =
  /(?<![\p{L}\d])(?:at|na|no|nas|nos|pela|pelo)[ \t]+(\p{Lu}[\p{L}\d'’]*(?:[ \t]+\p{Lu}[\p{L}\d'’]*)*)/gu;

/**
 * Início (índice) de cada palavra que está em contexto de empresa: 2+ palavras com maiúscula depois da preposição,
 * ou uma só que não é termo de área/cargo ("no Mobile" é área; "na Acme" já é nome comum de checar).
 */
function companyRunStarts(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(COMPANY_RUN_RE)) {
    const run = m[1];
    const base = m.index + m[0].length - run.length;
    const words = [...run.matchAll(/\p{Lu}[\p{L}\d'’]*/gu)];
    if (words.length === 1 && COMMON_ROLE_WORDS.has(fold(words[0][0]))) continue;
    for (const w of words) out.add(base + w.index);
  }
  return out;
}

/** Marcadores de dado pessoal ocultado (`redactContact`, `[NOME]`): nunca podem ir para o documento. */
const PLACEHOLDER_RE = /\[(?:NOME|EMAIL|TELEFONE|ENDERECO)\]/g;
const isPlaceholder = (t: string) => /^\[(?:NOME|EMAIL|TELEFONE|ENDERECO)\]$/.test(t);

function capitalizedMidSentence(text: string): { word: string; end: number }[] {
  const out: { word: string; end: number }[] = [];
  for (const m of text.matchAll(/(?<![\p{L}\d])\p{Lu}[\p{L}\d'’]*/gu)) {
    const word = m[0];
    if (word.length > 1 && word === word.toUpperCase()) continue; // sigla
    if (text[m.index + word.length] === "." && /[a-z]/.test(text[m.index + word.length + 1] ?? "")) continue; // Three.js
    let i = m.index - 1;
    let newline = false;
    while (i >= 0 && /\s/.test(text[i])) {
      if (text[i] === "\n" || text[i] === "\r") newline = true;
      i--;
    }
    if (i < 0 || newline || SENTENCE_END.has(text[i])) continue; // início de frase
    out.push({ word, end: m.index + word.length });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Senioridade/cargo, certificações/formação, números por extenso, siglas e empresas
// ---------------------------------------------------------------------------

// Grupos de termos equivalentes (já dobrados: sem acento, minúsculos). Um grupo vale se QUALQUER termo dele
// aparece na fonte. Os cargos/senioridades valem também se aparecem na vaga, mas só na carta (ver `checkText`).
const SENIORITY_GROUPS = [
  ["junior"], ["pleno", "mid-level", "mid level", "midlevel"], ["senior"], ["staff"],
  ["principal engineer", "principal developer"], ["tech lead", "team lead", "lider tecnico", "lider de equipe"],
  ["head of"], ["engineering manager", "gerente de engenharia"], ["coordenador", "coordenadora", "coordinator"],
  ["architect", "arquiteto", "arquiteta"], ["director", "diretor", "diretora"], ["cto"], ["vp"],
];
// Palavras que, logo antes ou depois do termo, indicam que ele descreve OUTRAS pessoas ("devs júnior").
const OTHER_PEOPLE = new Set(
  ["devs", "squads", "developers", "engineers", "engenheiros", "engenheiras", "desenvolvedores", "desenvolvedoras",
    "times", "equipe", "equipes", "teams", "profissionais", "pessoas", "people", "colegas", "analistas"],
);
const CREDENTIAL_GROUPS = [
  ["certified", "certification", "certifications", "certificacao", "certificacoes", "certificado em",
    "certificada em", "certificados em", "certificadas em", "certificado pela", "certificado pelo",
    "certificada pela", "certificada pelo", "certificados pela", "certificados pelo", "certificadas pela", "certificadas pelo"],
  ["pmp"], ["csm"], ["mba"], ["mestrado", "master's", "msc"], ["doutorado", "phd"],
  ["bacharel", "bacharelado", "bachelor", "bachelor's"], ["pos-graduacao", "pos graduacao", "posgraduacao"],
];
// "um/uma/one/a" ficam de fora (artigos). Palavras numéricas valem se o VALOR está na fonte ("três" = "3") ou se
// a própria palavra está nela; multiplicadores e quantidades vagas só valem se a palavra está na fonte.
const NUMBER_WORD_VALUE: Record<string, string> = {
  dois: "2", duas: "2", tres: "3", quatro: "4", cinco: "5", seis: "6", sete: "7", oito: "8", nove: "9", dez: "10",
  onze: "11", doze: "12", treze: "13", catorze: "14", quatorze: "14", quinze: "15", dezesseis: "16", dezessete: "17",
  dezoito: "18", dezenove: "19", vinte: "20", cem: "100", mil: "1000", milhao: "1000000",
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11",
  twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18",
  nineteen: "19", twenty: "20", hundred: "100", thousand: "1000", million: "1000000",
};
const WORD_ONLY_NUMBERS = [
  "cento", "milhoes", "hundreds", "thousands", "millions", "dobrei", "dobrou", "dobramos", "triplicou", "triplicamos",
  "metade", "half", "double", "doubled", "tripled", "triple",
];
const WRITTEN_NUMBERS = [...Object.keys(NUMBER_WORD_VALUE), ...WORD_ONLY_NUMBERS];
const ACRONYM_ALLOWLIST = new Set(
  [
    "api", "rest", "ci", "cd", "ui", "ux", "sql", "http", "https", "json", "saas", "b2b", "b2c", "mvp", "kpi", "okr",
    "qa", "tdd", "bdd", "sla", "sdk", "cli", "orm", "spa", "ssr", "pwa", "seo", "it", "ti", "rh", "hr", "cv", "pdf",
    "usa", "eua", "br", "en", "pt", "ok", "url", "html", "css", "ia", "ai", "ml", "llm", "etl", "bi", "crm", "erp",
    "ddd", "solid", "crud", "mvc", "jwt", "sso", "lgpd", "e2e", "ssl", "tls", "gdpr", "oauth", "rpc", "grpc", "ide",
    "os", "gpu", "cpu", "ram", "dns", "vpn", "iot", "rpa", "dba", "sre", "poc", "mfa", "rbac", "cdn", "tcp", "udp",
    "sap", "aws", "gcp", "ftp", "ssh", "xml", "csv", "yaml", "pii", "nlp", "ocr", "gps",
    // UFs
    "ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt", "ms", "mg", "pa", "pb", "pr", "pe", "pi", "rj",
    "rn", "rs", "ro", "rr", "sc", "sp", "se", "to",
    // algarismos romanos (Dev II)
    "ii", "iii", "iv", "vi", "vii", "viii", "ix",
  ],
);
// Palavras antes das quais uma sigla desconhecida é tratada como nome de empresa ("na BTG", "at BTG").
const COMPANY_PREPOSITIONS = new Set(["na", "no", "nas", "nos", "pela", "pelo", "at", "for", "em", "from", "da", "do", "para"]);
// Produto/serviço colado a uma empresa ("Google Analytics", "AWS S3"): não é o nome da empresa em si.
const PRODUCT_WORDS = new Set(["s3", "analytics", "azure", "cloud", "workspace", "ads", "pay", "maps", "web", "docs", "drive", "meet"]);
const PRODUCT_AFTER = /^\s+(?:s3|analytics|azure|cloud|workspace|ads|pay|maps|web|docs|drive|meet)(?![\p{L}\d])/u;
// Empresas conhecidas, para pegar nomes em minúsculas ("na google"). Sem palavras comuns (meta, stone, vale).
const KNOWN_COMPANIES = [
  "google", "itau", "nubank", "amazon", "microsoft", "facebook", "oracle", "netflix", "uber", "spotify", "bradesco",
  "santander", "btg", "ifood", "magalu", "americanas", "petrobras", "embraer", "totvs", "stefanini", "accenture",
  "thoughtworks", "deloitte", "linkedin", "twitter", "ibm", "tesla", "airbnb", "shopify",
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
  /** Grupos de senioridade/cargo presentes no perfil. */
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

type BuiltFacts = { profile: Facts; jobWords: Set<string>; jobSeniorityOk: Set<number> };

function buildFacts(profile: Profile, job?: JobContext): BuiltFacts {
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
  const seniorityOk = groupsHit(folded, SENIORITY_RES);
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
    jobSeniorityOk: groupsHit(jobFolded, SENIORITY_RES),
  };
}

/** Fatos já calculados de um par perfil/vaga (opaco): ver `prepareFacts`. */
export type PreparedFacts = { readonly __prepared: true; readonly profile: Profile; readonly job: JobContext | undefined };
type PreparedInternal = PreparedFacts & { built: BuiltFacts };

const NO_JOB: JobContext = {};
const factsCache = new WeakMap<Profile, WeakMap<JobContext, PreparedInternal>>();

/**
 * Pré-calcula os fatos do perfil e da vaga (texto, números, stacks, HTML da vaga sem tags). O resultado fica em
 * cache por objeto de perfil/vaga (WeakMap): revalidar a cada tecla não reprocessa o perfil e a vaga inteiros.
 * Perfis e vagas são imutáveis no app (cada mudança gera um objeto novo), então o cache nunca fica velho.
 */
export function prepareFacts(profile: Profile, job?: JobContext): PreparedFacts {
  let byJob = factsCache.get(profile);
  if (!byJob) {
    byJob = new WeakMap();
    factsCache.set(profile, byJob);
  }
  const k = job ?? NO_JOB;
  let p = byJob.get(k);
  if (!p) {
    p = { __prepared: true, profile, job, built: buildFacts(profile, job) };
    byJob.set(k, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

type Where = Violation["where"];

type CheckEnv = {
  facts: Facts;
  jobWords: Set<string>;
  jobSeniorityOk: Set<number>;
  add: (kind: ViolationKind, text: string, where: Where, key: string) => void;
  /** Modo texto livre do assistente (RN-20): anos só do perfil e tabela estendida de números por extenso. */
  assist?: boolean;
  /** Stacks extras aceitas (as que o usuário escreveu). */
  extraStacks?: Set<string>;
};

// Números por extenso do assistente (pt/en/es): 0–20, dezenas, cem/cento/cien e mil. Só para texto livre;
// o CV mantém `NUMBER_WORD_VALUE`. "once" (es) fica de fora: é palavra comum em inglês.
const ASSIST_EXTRA_NUMBERS: Record<string, string> = {
  zero: "0", cero: "0",
  cuatro: "4", siete: "7", ocho: "8", nueve: "9", diez: "10", doce: "12", trece: "13", catorce: "14", quince: "15",
  dieciseis: "16", diecisiete: "17", dieciocho: "18", diecinueve: "19", veinte: "20",
  trinta: "30", quarenta: "40", cinquenta: "50", sessenta: "60", setenta: "70", oitenta: "80", noventa: "90",
  thirty: "30", forty: "40", fifty: "50", sixty: "60", seventy: "70", eighty: "80", ninety: "90",
  treinta: "30", cuarenta: "40", cincuenta: "50", sesenta: "60", ochenta: "80",   cien: "100", ciento: "100",
};
const ASSIST_NUMBER_WORD_VALUE: Record<string, string> = { ...NUMBER_WORD_VALUE, ...ASSIST_EXTRA_NUMBERS };
const ASSIST_WRITTEN_RE = termRegex([...Object.keys(ASSIST_NUMBER_WORD_VALUE), ...WORD_ONLY_NUMBERS]);

/**
 * `sourceText`: texto cujos números/termos por extenso valem para este trecho.
 * `allowJob`: termos da vaga (nomes, siglas, cargo/senioridade) valem; só na carta.
 */
function checkText(env: CheckEnv, text: string, where: Where, key: string, sourceText: string, allowJob = false): void {
  const { facts, jobWords, jobSeniorityOk, add, assist } = env;
  const inJob = (w: string) => allowJob && jobWords.has(w);
  const sourceNumbers = new Set(numberTokens(sourceText).map((t) => t.value));
  for (const t of numberTokens(text)) {
    if (t.yearLike) {
      // Texto livre (assistente): o ano só passa se estiver no perfil. Um número de 4 dígitos que vem só das
      // respostas ("2000 usuários") vale quando é quantidade em todas as ocorrências (ver `typedQuantity`).
      const typed = assist && sourceNumbers.has(t.value) && typedQuantity(text, sourceText, t.raw);
      if (!facts.years.has(t.raw) && (assist ? !typed : !sourceNumbers.has(t.value))) add("unknown_year", t.raw, where, key);
    } else if (!sourceNumbers.has(t.value)) {
      add("unknown_number", t.raw, where, key);
    }
  }
  for (const id of stackIdsIn(text)) {
    if (!facts.stacks.has(id) && !env.extraStacks?.has(id)) add("unknown_stack", STACK_LABEL.get(id) ?? id, where, key);
  }
  const flaggedNames = new Set<string>();
  const flagName = (w: string) => {
    flaggedNames.add(fold(w));
    for (const part of fold(w).split(/\s+/)) flaggedNames.add(part); // "tech lead" também cobre "Lead"
    add("unknown_name", w, where, key);
  };
  // Marcador literal de dado ocultado ("[NOME]"): destacar e deixar fora do PDF.
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    flaggedNames.add(fold(m[0].slice(1, -1)));
    add("unknown_name", m[0], where, key);
  }
  // Mesmo comprimento: os índices de `folded` são usados também sobre `text` (ver "à" abaixo).
  const folded = foldText(text).replace(/hiring manager/g, (x) => " ".repeat(x.length));

  // Senioridade/cargo (perfil; vaga só na carta); termo que descreve outras pessoas não conta.
  {
    SENIORITY_RES.forEach((re, i) => {
      if (facts.seniorityOk.has(i) || (allowJob && jobSeniorityOk.has(i))) return;
      re.lastIndex = 0;
      for (const m of folded.matchAll(re)) {
        const before = /([\p{L}]+)\s+$/u.exec(folded.slice(Math.max(0, m.index - 24), m.index))?.[1];
        const after = /^\s+([\p{L}]+)/u.exec(folded.slice(m.index + m[0].length, m.index + m[0].length + 24))?.[1];
        if ((before && OTHER_PEOPLE.has(before)) || (after && OTHER_PEOPLE.has(after))) continue;
        // "Reportava ao CTO", "para o diretor", "to the CTO": outra pessoa.
        const lead = folded.slice(Math.max(0, m.index - 16), m.index);
        if (/(?:^|\s)(?:ao|para o|para a|to the|reporting to|reported to)\s+$/.test(lead)) continue;
        if (/(?:^|\s)à\s+$/i.test(text.slice(Math.max(0, m.index - 4), m.index))) continue;
        flagName(m[0]);
        break;
      }
    });
  }
  // Certificação/formação: só perfil.
  CREDENTIAL_RES.forEach((re, i) => {
    re.lastIndex = 0;
    const m = re.exec(folded);
    if (m && !facts.credentialOk.has(i)) flagName(m[0]);
  });

  // Números por extenso, fora dos trechos já lidos como numerais ("1,5 mil"). Valem se o valor ou a própria
  // palavra está na fonte; "dez" colado a ano/dia é mês; "two-factor"/"Three.js" não são números.
  const f0 = foldText(text);
  const noDigits = f0.replace(NUMBER_RE, (x) => " ".repeat(x.length));
  const sourceFolded = foldText(sourceText);
  const sourceWords = wordSet(sourceFolded);
  for (const m of noDigits.matchAll(assist ? ASSIST_WRITTEN_RE : WRITTEN_RE)) {
    const w = m[0];
    const end = m.index + w.length;
    const next = f0[end];
    if (next === "-" || (next === "." && /[\p{L}\d]/u.test(f0[end + 1] ?? ""))) continue;
    if (f0[m.index - 1] === "-") continue;
    if (w === "dez" && (/\d\s*$/.test(f0.slice(Math.max(0, m.index - 8), m.index)) || /^\s*\d/.test(f0.slice(end, end + 8)))) continue;
    if (w === "cento" && /por\s+$/.test(f0.slice(Math.max(0, m.index - 8), m.index))) continue;
    const value = assist ? ASSIST_NUMBER_WORD_VALUE[w] : NUMBER_WORD_VALUE[w];
    if (sourceWords.has(w) || (value !== undefined && sourceNumbers.has(value))) continue;
    add("unknown_number", w, where, key);
  }

  const companyStarts = companyRunStarts(text);
  for (const { word: w, end } of capitalizedMidSentence(text)) {
    const f = fold(w);
    // Produto colado a uma empresa ("Amazon S3", "Google Analytics").
    if (PRODUCT_WORDS.has(f) || PRODUCT_AFTER.test(foldText(text.slice(end, end + 24)))) continue;
    const common = COMMON_CAPITALIZED.has(f) && !(COMMON_ROLE_WORDS.has(f) && companyStarts.has(end - w.length));
    if (common || CATALOG_WORDS.has(f) || facts.words.has(f) || inJob(f) || flaggedNames.has(f)) continue;
    flagName(w);
  }

  // Empresas conhecidas em minúsculas.
  for (const m of folded.matchAll(COMPANY_RE)) {
    const after = folded.slice(m.index + m[0].length, m.index + m[0].length + 24);
    const compound = /^-\p{L}/u.test(after) || /\p{L}-$/u.test(folded.slice(Math.max(0, m.index - 2), m.index));
    if (compound || PRODUCT_AFTER.test(after)) continue;
    if (!facts.words.has(m[0]) && !inJob(m[0]) && !flaggedNames.has(m[0])) flagName(m[0]);
  }

  // Siglas desconhecidas, só como nome de empresa (depois de "na", "no", "at", "for"...). As demais ficam com
  // `unknown_stack` (catálogo) e com a lista de siglas comuns.
  for (const m of text.matchAll(ACRONYM_RE)) {
    const f = fold(m[0]);
    const base = f.endsWith("s") ? f.slice(0, -1) : f;
    const known = (x: string) => ACRONYM_ALLOWLIST.has(x) || CATALOG_WORDS.has(x) || facts.words.has(x) || inJob(x);
    if (known(f) || known(base) || flaggedNames.has(f)) continue;
    const prev = /([\p{L}]+)\s+$/u.exec(text.slice(Math.max(0, m.index - 16), m.index))?.[1];
    if (prev && COMPANY_PREPOSITIONS.has(prev.toLowerCase())) flagName(m[0]);
  }
}

/**
 * @param profile perfil local do usuário (fonte de verdade).
 * @param docs saída do modelo.
 * @param job contexto opcional da vaga (3º parâmetro, compatível com a assinatura do brief): empresa, cargo
 *   e nomes da descrição não geram `unknown_name` na carta (no CV, só o perfil vale).
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
 * - A vaga só libera termos na CARTA (que pode citar o cargo e a empresa da vaga). No CV (título, resumo, bullets,
 *   skills), senioridade, cargos, nomes, siglas e empresas valem só se estão no perfil: "Sênior" copiado de uma
 *   vaga Sênior com perfil Pleno é violação. Tecnologia da vaga ausente do perfil continua `unknown_stack`.
 * - Em contexto de empresa (depois de at/na/no/for/em/pela/pelo), palavras comuns de cargo/área ("Cloud Data
 *   Software") não isentam o nome: só valem se estão no perfil (ou na vaga, na carta).
 *
 * @param prepared opcional: fatos de `prepareFacts(profile, job)` (o cache é usado de qualquer forma).
 */
export function validateTailored(profile: Profile, docs: TailoredDocs, job?: JobContext, prepared?: PreparedFacts): Violation[] {
  const p = prepared && prepared.profile === profile && prepared.job === job ? prepared : prepareFacts(profile, job);
  const { profile: facts, jobWords, jobSeniorityOk } = (p as PreparedInternal).built;
  const out: Violation[] = [];
  const seen = new Set<string>();
  const add = (kind: ViolationKind, text: string, where: Where, key: string) => {
    const id = `${kind}|${text}|${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ kind, text, where, key });
  };

  const env: CheckEnv = { facts, jobWords, jobSeniorityOk, add };
  const cvWhere: Where = { part: "cv" };

  // skills
  docs.cv.skills.forEach((skill, i) => {
    const id = skillId(skill);
    const ok = id ? facts.stacks.has(id) : facts.skillNames.has(fold(skill.trim()));
    if (!ok) add("unknown_skill", skill, cvWhere, skillKey(i, skill));
  });
  checkText(env, docs.cv.headline, cvWhere, headlineKey(docs.cv.headline), facts.all);
  checkText(env, docs.cv.summary, cvWhere, summaryKey(docs.cv.summary), facts.all);

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
      checkText(env, b.text, where, key, sources.join("\n"));
    });
  }

  if (docs.coverLetter) checkText(env, docs.coverLetter, { part: "letter" }, letterKey(docs.coverLetter), facts.all, true);
  return out;
}

/**
 * Validador do RN-20 para texto livre do assistente de IA do perfil. Números e stacks valem se estão no perfil
 * ou em `sourceText` (respostas da entrevista / texto que o usuário pediu para reescrever); anos e nomes, só no
 * perfil (um número de 4 dígitos dito pelo usuário vale se não aparece como data). Nomes comparam sem caixa e
 * sem acento (já é a regra do CV), o que já cobre a tradução.
 */
export function validateAssistOutput(profile: Profile, sourceText: string, texts: string[]): Violation[] {
  const { profile: facts, jobWords, jobSeniorityOk } = (prepareFacts(profile) as PreparedInternal).built;
  const out: Violation[] = [];
  const seen = new Set<string>();
  const add = (kind: ViolationKind, text: string, where: Where, key: string) => {
    const id = `${kind}|${text}|${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ kind, text, where, key });
  };
  const env: CheckEnv = { facts, jobWords, jobSeniorityOk, add, assist: true, extraStacks: new Set(stackIdsIn(sourceText)) };
  const source = `${facts.all}\n${sourceText}`;
  for (const t of texts) checkText(env, t, { part: "cv" }, `assist:${textHash(t)}`, source);
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
        if (isPlaceholder(v.text)) return `${at}: remova o marcador ${v.text}; ele substitui um dado pessoal ocultado e não pode aparecer no texto`;
        return v.where.part === "letter"
          ? `${at}: o termo "${v.text}" (nome, sigla, cargo, senioridade ou certificação) não aparece no perfil nem na vaga; remova-o`
          : `${at}: o termo "${v.text}" (nome, sigla, cargo, senioridade ou certificação) não aparece no perfil; no CV, use só o que está no perfil (não copie da vaga); remova-o`;
    }
  });
}
