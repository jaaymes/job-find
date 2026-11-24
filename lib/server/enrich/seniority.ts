import "server-only";
import type { Seniority } from "@/lib/shared/types/job";
import { normalizeText } from "./text";

const RULES: [Seniority, RegExp][] = [
  ["intern", /\b(estagio|estagiari[oa]|intern|internship)\b/],
  ["lead", /\b(staff|principal|lead|lider|tech lead|head|especialista)\b/],
  ["senior", /\b(senior|sr)\b/],
  ["mid", /\b(pleno|mid|mid-level|pl)\b/],
  ["junior", /\b(junior|jr)\b/],
];

export function detectSeniority(title: string, hint: Seniority | null): Seniority | null {
  if (hint) return hint;
  const t = normalizeText(title);
  for (const [level, re] of RULES) {
    if (re.test(t)) return level;
  }
  return null;
}
