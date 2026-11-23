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

/**
 * Projeção mínima do perfil (D-11): sem `contact` (e-mail, telefone, links) e sem nome. Os textos livres passam
 * por `redactContact` como defesa extra contra e-mail, telefone e endereço escritos no meio do texto.
 */
export function projectProfile(p: Profile) {
  return {
    headline: clean(p.headline),
    location: clean(p.location),
    seniority: p.seniority,
    englishLevel: p.englishLevel,
    summary: clean(p.summary),
    skills: p.skills.map((s) => ({ name: s.name, years: s.years })),
    experiences: p.experiences.map((e) => ({
      company: redactContact(e.company),
      title: redactContact(e.title),
      startDate: e.startDate,
      endDate: e.endDate,
      bullets: e.bullets.map((b) => redactContact(b.text)),
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
 * `exp_N` e `exp_N.bM`. Sem nome, contato, links, local nem formação (o `assembleCv` preenche isso localmente).
 */
export function projectProfileForTailor(p: Profile) {
  return {
    headline: clean(p.headline),
    seniority: p.seniority,
    summary: clean(p.summary),
    skills: p.skills.map((s) => ({ name: s.name, years: s.years })),
    experiences: p.experiences.map((e) => ({
      id: e.id,
      company: redactContact(e.company),
      title: redactContact(e.title),
      startDate: e.startDate,
      endDate: e.endDate,
      bullets: e.bullets.map((b) => ({ id: b.id, text: redactContact(b.text) })),
    })),
  };
}
