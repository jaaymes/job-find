import type { AiTask, ModelInfo } from "@/lib/client/ai/providers";

/** Tokens típicos de uma operação (estimativa grosseira, só para dar ordem de grandeza). */
const USAGE: Record<AiTask, { tokensIn: number; tokensOut: number; unit: string }> = {
  extract: { tokensIn: 4000, tokensOut: 3000, unit: "currículo" },
  analyze: { tokensIn: 3000, tokensOut: 800, unit: "vaga" },
  cv: { tokensIn: 3500, tokensOut: 2000, unit: "CV" },
};

function formatUsd(n: number): string {
  const digits = n < 0.01 ? 4 : 2;
  return n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

type Priced = Pick<ModelInfo, "priceIn" | "priceOut">;

/** Custo em USD por operação; `undefined` quando o provedor não informa preço. */
export function operationCost(task: AiTask, model: Priced | undefined): number | undefined {
  if (model?.priceIn === undefined || model.priceOut === undefined) return undefined;
  const { tokensIn, tokensOut } = USAGE[task];
  return (tokensIn * model.priceIn + tokensOut * model.priceOut) / 1e6;
}

/** Custo estimado por operação (`undefined` sem preço) a partir dos preços (USD por milhão de tokens) do `listModels`. */
export function estimateCost(task: AiTask, model: Priced | undefined): string | undefined {
  const usd = operationCost(task, model);
  if (usd === undefined) return undefined;
  const { unit } = USAGE[task];
  if (usd === 0) return `grátis por ${unit}`;
  return `≈ US$ ${formatUsd(usd)} por ${unit}`;
}

const byLabel = (a: ModelInfo, b: ModelInfo) =>
  a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Grátis primeiro, depois do mais barato ao mais caro; sem preço no fim. Devolve uma nova lista. */
export function sortModelsByCost<T extends ModelInfo>(task: AiTask, models: T[]): T[] {
  return models
    .map((m) => ({ m, cost: operationCost(task, m) }))
    .sort((a, b) => {
      if (a.cost === undefined && b.cost === undefined) return byLabel(a.m, b.m);
      if (a.cost === undefined) return 1;
      if (b.cost === undefined) return -1;
      return a.cost - b.cost || byLabel(a.m, b.m);
    })
    .map(({ m }) => m);
}

/** Rótulo curto de preço para a lista de modelos. */
export function priceLabel(task: AiTask, model: ModelInfo): string {
  const usd = operationCost(task, model);
  if (usd === undefined) return "";
  if (usd === 0) return "grátis";
  return `≈ US$ ${formatUsd(usd)} por ${USAGE[task].unit}`;
}
