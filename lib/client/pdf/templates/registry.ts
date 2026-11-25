import type { CvSectionId, CvTemplate } from "./types";

const INK = "#111111";

const base = {
  baseSize: 10,
  nameSize: 20,
  margins: { v: 40, h: 44 },
  sectionGap: 12,
  titleCase: "normal" as const,
  titleRule: true,
  accent: INK,
  nameAlign: "left" as const,
};

const S = (...s: CvSectionId[]): CvSectionId[] => s;

export const CV_TEMPLATES: readonly CvTemplate[] = [
  {
    id: "classico",
    name: "Clássico",
    description: "Layout equilibrado em Inter, com linhas sob os títulos.",
    bestFor: "Qualquer perfil",
    sections: S("summary", "experience", "skills", "projects", "education", "certifications", "languages"),
    font: { body: "Inter", headings: "Inter" },
    tokens: { ...base },
    skillsLayout: "inline",
    locationLine: false,
  },
  {
    id: "compacto",
    name: "Compacto técnico",
    description: "Fonte menor, margens enxutas e competências agrupadas por área.",
    bestFor: "Devs com muita experiência que querem caber em 1 página",
    sections: S("skills", "experience", "projects", "education", "certifications", "languages"),
    font: { body: "Inter", headings: "Inter" },
    tokens: { ...base, baseSize: 9.5, nameSize: 19, margins: { v: 28, h: 32 }, sectionGap: 9, titleCase: "upper" },
    skillsLayout: "grouped",
    locationLine: false,
  },
  {
    id: "harvard",
    name: "Harvard",
    description: "Fonte com serifa, nome centralizado e formação em primeiro lugar.",
    bestFor: "Formação forte, vagas corporativas ou acadêmicas",
    sections: S("education", "experience", "projects", "skills", "certifications", "languages"),
    font: { body: "Source Serif 4", headings: "Source Serif 4" },
    tokens: { ...base, nameSize: 22, nameAlign: "center" },
    skillsLayout: "inline",
    locationLine: false,
  },
  {
    id: "minimalista",
    name: "Minimalista",
    description: "Leitura limpa, sem linhas e com mais espaço entre as seções.",
    bestFor: "Quem prefere um visual simples",
    sections: S("summary", "experience", "skills", "education", "languages"),
    font: { body: "JF Sans", headings: "JF Sans" },
    tokens: { ...base, titleRule: false, sectionGap: 18 },
    skillsLayout: "inline",
    locationLine: false,
  },
  {
    id: "moderno",
    name: "Moderno com acento",
    description: "JF Grotesk (derivada da IBM Plex Sans) com títulos e linhas em azul-escuro.",
    bestFor: "Produto, front-end e startups",
    sections: S("summary", "skills", "experience", "projects", "education", "certifications", "languages"),
    font: { body: "JF Grotesk", headings: "JF Grotesk" },
    tokens: { ...base, accent: "#1F3A5F" },
    skillsLayout: "inline",
    locationLine: false,
  },
  {
    id: "resultados",
    name: "Foco em resultados",
    description: "Abre com até 3 destaques em negrito, escolhidos por você.",
    bestFor: "Perfis sêniores com resultados mensuráveis",
    sections: S("summary", "highlights", "experience", "skills", "education", "certifications", "languages"),
    font: { body: "Inter", headings: "Inter" },
    tokens: { ...base },
    skillsLayout: "inline",
    locationLine: false,
    boldHighlights: true,
  },
  {
    id: "lideranca",
    name: "Liderança",
    description: "Títulos com serifa e corpo sem serifa, com competências logo no início.",
    bestFor: "Tech lead, staff e gestão",
    sections: S("summary", "skills", "experience", "education", "certifications", "languages"),
    font: { body: "Inter", headings: "Source Serif 4" },
    tokens: { ...base },
    skillsLayout: "inline",
    locationLine: false,
  },
  {
    id: "inicio-de-carreira",
    name: "Início de carreira",
    description: "Projetos em destaque antes da experiência.",
    bestFor: "Estágio e vagas júnior",
    sections: S("summary", "skills", "projects", "education", "experience", "certifications", "languages"),
    font: { body: "Inter", headings: "Inter" },
    tokens: { ...base },
    skillsLayout: "inline",
    locationLine: false,
    projectStacksOnOwnLine: true,
  },
  {
    id: "transicao",
    name: "Transição de carreira",
    description: "Competências e projetos antes da experiência.",
    bestFor: "Quem vem de outra área",
    sections: S("summary", "skills", "projects", "experience", "education", "certifications", "languages"),
    font: { body: "JF Sans", headings: "JF Sans" },
    tokens: { ...base },
    skillsLayout: "inline",
    locationLine: false,
  },
  {
    id: "internacional",
    name: "Internacional",
    description: "Rótulos no idioma do CV e linha de localização com disponibilidade remota.",
    bestFor: "Vagas em inglês (EUA e remoto)",
    sections: S("summary", "experience", "skills", "projects", "education", "certifications", "languages"),
    font: { body: "Inter", headings: "Inter" },
    tokens: { ...base },
    skillsLayout: "inline",
    locationLine: true,
  },
];

/** Id desconhecido, nulo ou ausente cai em `classico`. */
export function getTemplate(id: string | null | undefined): CvTemplate {
  return CV_TEMPLATES.find((t) => t.id === id) ?? CV_TEMPLATES[0];
}

