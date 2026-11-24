import "server-only";
import type { WorkMode } from "@/lib/shared/types/job";
import { normalizeText } from "./text";

const HYBRID = /\b(hibrido|hybrid)\b/;
const ONSITE = /\b(presencial|on-?site|in[- ]office)\b/;
const REMOTE = /\b(remoto|remote|home[- ]?office|work from home|anywhere)\b/;

/** RN-04: campo estruturado vence o texto; no texto, híbrido vence remoto. */
export function classifyWorkMode(hint: WorkMode | null, text: string): WorkMode {
  if (hint && hint !== "unknown") return hint;
  const t = normalizeText(text);
  if (HYBRID.test(t)) return "hybrid";
  if (REMOTE.test(t)) return "remote";
  if (ONSITE.test(t)) return "onsite";
  return "unknown";
}
