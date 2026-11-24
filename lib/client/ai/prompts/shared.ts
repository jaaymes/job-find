import "client-only";

import { redactContact } from "@/lib/client/extract/contact";
import type { Profile } from "@/lib/shared/schemas/profile";
import type { JobDetail } from "@/lib/shared/types/job";
import { wrapUntrusted } from "./untrusted";

export const JOB_MAX_CHARS = 12_000;

const ANSWER_PLACEHOLDER = "não informado";

const BLOCK_TAGS = "p,li,div,h1,h2,h3,h4,h5,h6,br,tr,ul,ol,section,article,pre,blockquote";

/** HTML da descrição vira texto puro: DOMParser não executa scripts nem carrega recursos. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,template").forEach((n) => n.remove());
  doc.querySelectorAll(BLOCK_TAGS).forEach((el) => {
    el.appendChild(doc.createTextNode("\n"));
  });
  return (doc.body.textContent ?? "")
    .replace(/ /g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const clean = (s: string | null | undefined) => (s ? redactContact(s) : null);

export const NAME_PLACEHOLDER = "[NOME]";
// Partículas de nome ("Ana dos Santos"): não são o nome e trocá-las estragaria o texto ("dos usuários").
const NAME_PARTICLES = new Set(["das", "dos", "del", "der", "van", "von", "les", "los", "las", "and"]);

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const unaccent = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");

const capFirst = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
const variants = (w: string) => [...new Set([w.normalize("NFC"), unaccent(w)])];
const altOf = (terms: string[]) => [...new Set(terms)].filter(Boolean).sort((a, b) => b.length - a.length).map(escapeRe).join("|");

/** Troca o nome do usuário num texto livre por `[NOME]`. */
export type NameRedactor = (text: string) => string;

/**
 * Redator do nome do usuário (`null` sem nome). Para não estragar palavras comuns ("Novos campos", "Fundo branco",
 * "Rio de Janeiro" com sobrenome Rio):
 * - só casa partes com inicial maiúscula (sensível à 1ª letra), com e sem acento, de 3+ letras e sem partículas;
 * - o nome inteiro, ou 2+ partes em sequência ("Maria Campos", "Campos Branco", "Ana dos Santos"), viram `[NOME]`;
 * - uma parte sozinha só vira `[NOME]` se for o primeiro nome ("Maria liderou"); sobrenome sozinho fica.
 */
export function nameRedactor(name: string | null | undefined): NameRedactor | null {
  const full = (name ?? "").trim().replace(/\s+/g, " ");
  if (!full) return null;
  const raw = full.split(/[^\p{L}'’-]+/u).filter((w) => (w.match(/\p{L}/gu)?.length ?? 0) >= 3 && !NAME_PARTICLES.has(w.toLowerCase()));
  const parts = raw.map(capFirst);
  const fullRe = new RegExp(`(?<![\\p{L}\\d])(?:${altOf([...variants(full), ...variants(full.split(" ").map(capFirst).join(" "))])})(?![\\p{L}\\d])`, "gu");
  const firstName = new Set(parts.length > 0 && raw[0] === full.split(/[^\p{L}'’-]+/u).find(Boolean) ? variants(parts[0]) : []);
  const partAlt = altOf(parts.flatMap(variants));
  const runRe = partAlt
    ? new RegExp(
        `(?<![\\p{L}\\d])(?:${partAlt})(?:[ \\t]+(?:(?:de|da|do|dos|das|e|del|van|von)[ \\t]+)?(?:${partAlt}))*(?![\\p{L}\\d])`,
        "gu",
      )
    : null;
  const partSet = new Set(parts.flatMap(variants));
  return (text) => {
    const t = text.normalize("NFC").replace(fullRe, NAME_PLACEHOLDER);
    if (!runRe) return t;
    return t.replace(runRe, (m) => {
      const n = m.split(/[ \t]+/).filter((w) => partSet.has(w)).length;
      return n >= 2 || firstName.has(m) ? NAME_PLACEHOLDER : m;
    });
  };
}

/** Texto livre (título, resumo, bullets): contato redigido e o nome do usuário trocado por `[NOME]`. */
function freeText(s: string, redactName: NameRedactor | null): string {
  const t = redactContact(s);
  return redactName ? redactName(t) : t;
}
const cleanFree = (s: string | null | undefined, redactName: NameRedactor | null) => (s ? freeText(s, redactName) : null);

/**
 * Projeção mínima do perfil (D-11): sem `contact` (e-mail, telefone, links) e sem nome. Os textos livres passam
 * por `redactContact` como defesa extra contra e-mail, telefone e endereço escritos no meio do texto, e o nome
 * do usuário escrito neles (resumo, bullets) vira `[NOME]`.
 */
export function projectProfile(p: Profile) {
  const nameRe = nameRedactor(p.name);
  return {
    headline: cleanFree(p.headline, nameRe),
    location: clean(p.location),
    seniority: p.seniority,
    englishLevel: p.englishLevel,
    summary: cleanFree(p.summary, nameRe),
    skills: p.skills.map((s) => ({ name: s.name, years: s.years })),
    experiences: p.experiences.map((e) => ({
      company: redactContact(e.company),
      title: redactContact(e.title),
      startDate: e.startDate,
      endDate: e.endDate,
      bullets: e.bullets.map((b) => freeText(b.text, nameRe)),
    })),
    education: p.education.map((e) => ({
      institution: redactContact(e.institution),
      degree: clean(e.degree),
      startYear: e.startYear,
      endYear: e.endYear,
    })),
  };
}

export function jobFacts(job: JobDetail, opts: { language?: boolean; place?: boolean } = {}): string {
  const place = [job.city, job.country].filter(Boolean).join(", ") || ANSWER_PLACEHOLDER;
  return [
    `Modalidade: ${job.workMode}`,
    `Senioridade: ${job.seniority ?? ANSWER_PLACEHOLDER}`,
    ...(opts.language === false ? [] : [`Idioma: ${job.language}`]),
    ...(opts.place === false ? [] : [`Local: ${place}`]),
    `Tecnologias detectadas: ${job.stacks.join(", ") || ANSWER_PLACEHOLDER}`,
  ].join("\n");
}

/** Vaga como texto não confiável delimitado (título, empresa e descrição), truncada em `JOB_MAX_CHARS`. */
export function wrapJobDescription(job: JobDetail, extraLines: string[] = []): string {
  const head = [`${job.title} - ${job.company}`, ...extraLines].join("\n");
  return wrapUntrusted("job_description", `${head}\n\n${htmlToText(job.descriptionHtml)}`, JOB_MAX_CHARS);
}

/**
 * Projeção do perfil para a geração de CV (D-11): só o que o modelo precisa para reescrever e ordenar, com os ids
 * `exp_N` e `exp_N.bM`. Sem nome, contato, links, local nem formação (o `assembleCv` preenche isso localmente). O
 * nome escrito nos textos livres (título, resumo, bullets) vira `[NOME]`.
 */
export function projectProfileForTailor(p: Profile) {
  const nameRe = nameRedactor(p.name);
  return {
    headline: cleanFree(p.headline, nameRe),
    seniority: p.seniority,
    summary: cleanFree(p.summary, nameRe),
    skills: p.skills.map((s) => ({ name: s.name, years: s.years })),
    experiences: p.experiences.map((e) => ({
      id: e.id,
      company: redactContact(e.company),
      title: redactContact(e.title),
      startDate: e.startDate,
      endDate: e.endDate,
      bullets: e.bullets.map((b) => ({ id: b.id, text: freeText(b.text, nameRe) })),
    })),
  };
}
