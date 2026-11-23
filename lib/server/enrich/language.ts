import "server-only";
import { franc } from "franc-min";

const MAP: Record<string, "pt" | "en" | "es"> = { por: "pt", eng: "en", spa: "es" };

/** RN-08: idioma da descrição; textos curtos demais são 'unknown'. */
export function detectLanguage(text: string): "pt" | "en" | "es" | "unknown" {
  const t = text.trim();
  if (t.length < 200) return "unknown";
  return MAP[franc(t, { only: ["por", "eng", "spa"] })] ?? "unknown";
}
