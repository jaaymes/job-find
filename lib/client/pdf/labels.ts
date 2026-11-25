import type { CvLang } from "@/lib/client/cv/period";
import type { StackCategory } from "@/lib/shared/stacks";

export const SECTION_LABELS: Record<
  CvLang,
  { summary: string; experience: string; skills: string; education: string; projects: string; certifications: string; languages: string; highlights: string }
> = {
  pt: { summary: "Resumo", experience: "Experiência", skills: "Competências", education: "Formação", projects: "Projetos", certifications: "Certificações", languages: "Idiomas", highlights: "Destaques" },
  en: { summary: "Summary", experience: "Experience", skills: "Skills", education: "Education", projects: "Projects", certifications: "Certifications", languages: "Languages", highlights: "Key achievements" },
  es: { summary: "Resumen", experience: "Experiencia", skills: "Habilidades", education: "Educación", projects: "Proyectos", certifications: "Certificaciones", languages: "Idiomas", highlights: "Logros destacados" },
};

/** Rótulos das categorias de competência (template com `skillsLayout: "grouped"`). */
export const CATEGORY_LABELS: Record<CvLang, Record<StackCategory, string>> = {
  pt: { frontend: "Front-end", backend: "Back-end", mobile: "Mobile", data: "Dados", devops: "DevOps", qa: "Qualidade", lang: "Linguagens", other: "Outras" },
  en: { frontend: "Frontend", backend: "Backend", mobile: "Mobile", data: "Data", devops: "DevOps", qa: "QA", lang: "Languages", other: "Other" },
  es: { frontend: "Frontend", backend: "Backend", mobile: "Móvil", data: "Datos", devops: "DevOps", qa: "Calidad", lang: "Lenguajes", other: "Otras" },
};
