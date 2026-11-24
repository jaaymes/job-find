import { z } from "@/lib/shared/zod";

// Relatório da análise com IA (RF-16, US-05). É o schema que o modelo preenche.
// Sem `min`/`max` na nota: provedores com `json_schema` estrito ignoram limites; o cliente aplica o clamp 0-100.
export const FitAnalysis = z.object({
  /** O que no perfil atende bem a vaga. */
  strengths: z.array(z.string()),
  /** O que a vaga pede e o currículo não mostra. */
  gaps: z.array(z.string()),
  /** Termos da vaga que faltam no currículo (para ATS). */
  missingKeywords: z.array(z.string()),
  /** Nota revisada de aderência, 0 a 100. */
  revisedScore: z.number(),
});
export type FitAnalysis = z.infer<typeof FitAnalysis>;

export const FIT_MAX_ITEMS = 8;
export const FIT_MAX_ITEM_CHARS = 300;

/** Limita a nota a 0-100 (inteira) e o tamanho das listas: o modelo não é confiável para respeitar limites. */
export function normalizeFit(f: FitAnalysis): FitAnalysis {
  const list = (xs: string[]) =>
    xs
      .map((x) => x.trim().slice(0, FIT_MAX_ITEM_CHARS))
      .filter((x) => x !== "")
      .slice(0, FIT_MAX_ITEMS);
  const score = Number.isFinite(f.revisedScore) ? Math.round(f.revisedScore) : 0;
  return {
    strengths: list(f.strengths),
    gaps: list(f.gaps),
    missingKeywords: list(f.missingKeywords),
    revisedScore: Math.min(100, Math.max(0, score)),
  };
}
