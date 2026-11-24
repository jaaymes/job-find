import "server-only";
import { extractStacks } from "@/lib/shared/stacks";
import { normalizeText } from "./text";

const ROLE_KEYWORDS = [
  "developer",
  "desenvolvedor(?:a)?",
  "engineer",
  "engenheir[oa] de (?:software|dados)",
  "programador(?:a)?",
  "qa",
  "tester",
  "sre",
  "devops",
  "data (?:scientist|engineer|analyst)",
  "(?:cientista|engenheir[oa]|analista) de dados",
  "arquitet[oa] de software",
  "tech lead",
  "cto",
  "mobile",
  "front-?end",
  "back-?end",
  "full-?stack",
  "ux(?:/ui)? designer",
  "ui(?:/ux)? designer",
  "product designer",
  "security engineer",
  "(?:ml|ai) engineer",
  "machine learning engineer",
];
const ROLE_RE = new RegExp(`\\b(?:${ROLE_KEYWORDS.join("|")})\\b`);

const NEGATIVE_RE =
  /\b(?:sales|mechanical|civil|electrical|chemical|field service|customer|marketing|mecanico|eletrico|vendas)\b/;

/** RN-01: vaga de tecnologia se o título/tags trazem stack ou o título traz cargo tech. */
export function isTechJob(title: string, tags: string[]): boolean {
  if (extractStacks({ title, tags }).length > 0) return true;
  const title_ = normalizeText(title);
  if (NEGATIVE_RE.test(title_)) return false;
  return ROLE_RE.test(title_);
}
