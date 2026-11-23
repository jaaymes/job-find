import "client-only";

import type { Profile } from "@/lib/shared/schemas/profile";
import type { TailoredDocs } from "@/lib/shared/schemas/tailored";
import { type CvLang, formatPeriod } from "./period";

export type AssembledCv = {
  name: string;
  contactLine: string;
  headline: string;
  summary: string;
  skills: string[];
  experiences: {
    company: string;
    role: string;
    period: string;
    /** `flagged`: alerta da validação RN-07 (Tarefa 32); sempre false até lá. */
    bullets: { text: string; flagged: boolean }[];
  }[];
  education: string[];
  certifications: string[];
  lang: CvLang;
};

function educationLine(e: Profile["education"][number]): string {
  const years = [e.startYear, e.endYear].filter(Boolean).join(" – ");
  const base = [e.degree, e.institution].filter(Boolean).join(" – ");
  return years ? `${base} (${years})` : base;
}

/**
 * Monta o CV (RN-07 camada 1): empresa, cargo, datas, formação e contato vêm só do perfil local; do modelo vêm
 * apenas o texto, a ordem das experiências e das skills. `expId` fora do perfil lança erro.
 */
export function assembleCv(profile: Profile, docs: TailoredDocs, lang: CvLang = "pt"): AssembledCv {
  const byId = new Map(profile.experiences.map((e) => [e.id, e]));
  const { contact } = profile;
  return {
    name: profile.name ?? "",
    contactLine: [contact.email, contact.phone, profile.location, ...contact.links]
      .filter((s): s is string => !!s)
      .map((s) => s.replace(/^https?:\/\/(www\.)?/, ""))
      .join(" | "),
    headline: docs.cv.headline,
    summary: docs.cv.summary,
    skills: docs.cv.skills,
    experiences: docs.cv.experiences.map((x) => {
      const exp = byId.get(x.expId);
      if (!exp) throw new Error(`expId desconhecido: ${x.expId}`);
      return {
        company: exp.company,
        role: exp.title,
        period: formatPeriod(exp.startDate, exp.endDate, lang),
        bullets: x.bullets.map((b) => ({ text: b.text, flagged: false })),
      };
    }),
    education: profile.education.map(educationLine),
    certifications: [],
    lang,
  };
}
