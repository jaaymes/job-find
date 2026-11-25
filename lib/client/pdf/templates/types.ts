import type { PdfFamily } from "../fonts";

export type CvSectionId =
  | "summary"
  | "highlights"
  | "skills"
  | "experience"
  | "projects"
  | "education"
  | "certifications"
  | "languages";

export type CvTemplateId =
  | "classico"
  | "compacto"
  | "harvard"
  | "minimalista"
  | "moderno"
  | "resultados"
  | "lideranca"
  | "inicio-de-carreira"
  | "transicao"
  | "internacional";

export type CvTemplate = {
  id: CvTemplateId;
  name: string;
  description: string;
  bestFor: string;
  /** Ordem do template; seção sem dados não aparece. */
  sections: CvSectionId[];
  font: { body: PdfFamily; headings: PdfFamily };
  tokens: {
    baseSize: number;
    nameSize: number;
    margins: { v: number; h: number };
    sectionGap: number;
    titleCase: "normal" | "upper";
    titleRule: boolean;
    /** Cor de acento (títulos e linhas), contraste >= 4.5:1 sobre branco (RN-32). */
    accent: string;
    nameAlign: "left" | "center";
  };
  /** `grouped` = por categoria de stack (compacto). */
  skillsLayout: "inline" | "grouped";
  /** Internacional: "Location: …" (D-05). */
  locationLine: boolean;
  /** Resultados: destaques em negrito. */
  boldHighlights?: boolean;
  /** Início de carreira: nome do projeto em negrito e stacks na linha seguinte. */
  projectStacksOnOwnLine?: boolean;
};
