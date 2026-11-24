import type { AiTask, ModelInfo } from "@/lib/client/ai/providers";

/** Tokens típicos de uma operação (estimativa grosseira, só para dar ordem de grandeza). */
const USAGE: Record<AiTask, { tokensIn: number; tokensOut: number; unit: string }> = {
  extract: { tokensIn: 4000, tokensOut: 1500, unit: "currículo" },
  analyze: { tokensIn: 3000, tokensOut: 800, unit: "vaga" },
  cv: { tokensIn: 3500, tokensOut: 2000, unit: "CV" },
};

function formatUsd(n: number): string {
  const digits = n < 0.01 ? 4 : 2;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Custo estimado por operação a partir dos preços (USD por milhão de tokens) do `listModels`. */
export function estimateCost(task: AiTask, model: Pick<ModelInfo, "priceIn" | "priceOut"> | undefined): string {
  if (model?.priceIn === undefined || model.priceOut === undefined) return "custo não informado pelo provedor";
  const { tokensIn, tokensOut, unit } = USAGE[task];
  const usd = (tokensIn * model.priceIn + tokensOut * model.priceOut) / 1e6;
  if (usd === 0) return `grátis por ${unit}`;
  return `≈ US$ ${formatUsd(usd)} por ${unit}`;
}
