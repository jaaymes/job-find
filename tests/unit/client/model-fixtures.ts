import type { ModelInfo } from "@/lib/client/ai/providers";
import { defaultAiSettings, type AiSettings } from "@/lib/client/ai/settings";

/** Fixtures compartilhadas pelos testes de `TaskModelRow` e `ModelPickerDialog`. */
export const ADDED_AT = "2026-11-24T00:00:00.000Z";

export const MODELS: ModelInfo[] = [
  { id: "anthropic/claude-haiku", label: "Claude Haiku", priceIn: 1, priceOut: 5 },
  { id: "x/sem-preco", label: "Outro Modelo" },
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek Flash", priceIn: 0.2, priceOut: 0.8 },
  { id: "acme/livre:free", label: "Livre", priceIn: 0, priceOut: 0 },
  { id: "openrouter/free", label: "Free Models Router", priceIn: 0, priceOut: 0 },
  { id: "google/gemini-flash", label: "Gêmini Flash", priceIn: 0.1, priceOut: 0.4 },
];

export function openRouterSettings(model: string | null = "deepseek/deepseek-v4.1-flash"): AiSettings {
  return {
    ...defaultAiSettings(),
    providers: { openrouter: { key: "sk-or-test", addedAt: ADDED_AT, source: "paste" } },
    tasks: { extract: model === null ? null : { provider: "openrouter", model }, analyze: null, cv: null },
  };
}
