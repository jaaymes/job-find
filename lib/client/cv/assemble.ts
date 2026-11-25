import "client-only";

import { LANGUAGE_LEVEL_LABEL, MAX_HIGHLIGHTS, type Profile } from "@/lib/shared/schemas/profile";
import type { TailoredDocs } from "@/lib/shared/schemas/tailored";
import { bulletKey, flagBullets, headlineKey, type ItemFlag, skillKey, summaryKey } from "./flags";
import { type CvLang, formatPeriod } from "./period";
import type { Violation } from "./validate";

export type AssembledCv = {
  name: string;
  contactLine: string;
  /** `profile.location` ou "" (usado pela linha "Location:" do template internacional). */
  location: string;
  headline: string;
  summary: string;
  skills: string[];
  experiences: {
    /** `exp_N` do perfil. */
    expId: string;
    /** 0 na primeira vez que o `expId` aparece, 1 na repetição etc. (entra na chave dos bullets). */
    occurrence: number;
    company: string;
    role: string;
    period: string;
    /**
     * `key` (`bulletKey`) é o id estável do trecho, atrelado ao texto. `flagged`: violação RN-07 ainda não aprovada
     * (destacar, contar e deixar fora do PDF). `violations`: os motivos. Ver `flagBullets`.
     */
    bullets: { key: string; text: string; /** `sourceBulletIds` do bullet (ids `exp_N.bM` do perfil). */ sources: string[]; flagged: boolean; violations: Violation[] }[];
  }[];
  /** Estado de revisão de headline, summary e skills (mesma semântica de `bullets[].flagged`). */
  flags: { headline: ItemFlag; summary: ItemFlag; skills: ItemFlag[] };
  education: string[];
  /** Projetos do perfil, como estão (sem IA), sem bullets vazios. */
  projects: { name: string; link: string | null; stacks: string[]; bullets: string[] }[];
  /** `"Nome – Emissor (Ano)"`. */
  certifications: string[];
  /** `"Inglês – Fluente"`, com o nível no idioma do CV. */
  languages: string[];
  /** `key` dos bullets não sinalizados que sustentam os destaques do perfil (até `MAX_HIGHLIGHTS`, na ordem do CV). */
  highlightKeys: string[];
  lang: CvLang;
};

function educationLine(e: Profile["education"][number]): string {
  const years = [e.startYear, e.endYear].filter(Boolean).join(" – ");
  const base = [e.degree, e.institution].filter(Boolean).join(" – ");
  if (!base) return "";
  return years ? `${base} (${years})` : base;
}

function certificationLine(c: Profile["certifications"][number]): string {
  const base = [c.name, c.issuer].filter(Boolean).join(" – ");
  return c.year ? `${base} (${c.year})` : base;
}

/**
 * Monta o CV (RN-07 camada 1): empresa, cargo, datas, formação e contato vêm só do perfil local; do modelo vêm
 * apenas o texto, a ordem das experiências e das skills. `expId` fora do perfil lança erro.
 */
export function assembleCv(
  profile: Profile,
  docs: TailoredDocs,
  lang: CvLang,
  /** Opcional: resultado de `validateTailored` e ids aprovados pelo usuário; aplica `flagBullets`. */
  review?: { violations: Violation[]; approvedFlags?: string[] },
): AssembledCv {
  const byId = new Map(profile.experiences.map((e) => [e.id, e]));
  const seen = new Map<string, number>();
  const { contact } = profile;
  const cv: AssembledCv = {
    name: profile.name ?? "",
    location: profile.location ?? "",
    contactLine: [contact.email, contact.phone, profile.location, ...contact.links]
      .filter((s): s is string => !!s)
      .map((s) => s.replace(/^https?:\/\/(www\.)?/, ""))
      .join(" | "),
    headline: docs.cv.headline,
    summary: docs.cv.summary,
    skills: docs.cv.skills,
    flags: {
      headline: { key: headlineKey(docs.cv.headline), flagged: false, violations: [] },
      summary: { key: summaryKey(docs.cv.summary), flagged: false, violations: [] },
      skills: docs.cv.skills.map((sk, i) => ({ key: skillKey(i, sk), flagged: false, violations: [] })),
    },
    experiences: docs.cv.experiences.flatMap((x) => {
      const occurrence = seen.get(x.expId) ?? 0;
      seen.set(x.expId, occurrence + 1);
      const exp = byId.get(x.expId);
      if (!exp) {
        // Com `review`, o `unknown_exp` já está na lista de violações: pula em vez de lançar.
        if (review) return [];
        throw new Error(`expId desconhecido: ${x.expId}`);
      }
      return [{
        expId: x.expId,
        occurrence,
        company: exp.company,
        role: exp.title,
        period: formatPeriod(exp.startDate, exp.endDate, lang),
        bullets: x.bullets.map((b, i) => ({ key: bulletKey(x.expId, occurrence, i, b.text), text: b.text, sources: b.sourceBulletIds, flagged: false, violations: [] })),
      }];
    }),
    education: profile.education.map(educationLine).filter((l) => l !== ""),
    projects: profile.projects
      .map((p) => ({ name: p.name, link: p.link, stacks: p.stacks, bullets: p.bullets.map((b) => b.text).filter((t) => t.trim() !== "") }))
      .filter((p) => p.name.trim() !== ""),
    certifications: profile.certifications.map(certificationLine).filter((l) => l.trim() !== ""),
    languages: profile.languages.map((l) => `${l.name} – ${LANGUAGE_LEVEL_LABEL[lang][l.level]}`),
    highlightKeys: [],
    lang,
  };
  const flagged = review ? flagBullets(cv, review.violations, review.approvedFlags) : cv;
  // Depois do `flagBullets`: bullet sinalizado nunca vira destaque.
  const wanted = new Set(profile.highlights);
  const highlightKeys = flagged.experiences
    .filter((x) => x.occurrence === 0)
    .flatMap((x) => x.bullets)
    .filter((b) => !b.flagged && b.sources.some((id) => wanted.has(id)))
    .map((b) => b.key)
    .slice(0, MAX_HIGHLIGHTS);
  return { ...flagged, highlightKeys };
}

/** CV base, sem vaga nem IA (RF-37): tudo vem do perfil, na ordem dele, e nada é sinalizado. */
export function assembleBaseCv(profile: Profile, lang: CvLang): AssembledCv {
  const docs: TailoredDocs = {
    cv: {
      headline: profile.headline ?? "",
      summary: profile.summary ?? "",
      skills: profile.skills.map((s) => s.name),
      experiences: profile.experiences.map((e) => ({
        expId: e.id,
        bullets: e.bullets.map((b) => ({ text: b.text, sourceBulletIds: [b.id] })),
      })),
    },
    coverLetter: null,
  };
  return assembleCv(profile, docs, lang);
}
