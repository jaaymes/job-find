import "client-only";

// Minimização de dados (D-11): e-mail e telefone nunca vão ao modelo de IA.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// Telefone brasileiro (DDI e DDD opcionais, 8 ou 9 dígitos) com ou sem máscara.
const PHONE_RE = /(?<![\dA-Za-z])(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}(?![\d])/g;
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
const YEAR_RANGE_RE = /^(?:19|20)\d{2}\D{1,3}(?:19|20)\d{2}$/;

export type Contact = { email: string | null; phone: string | null; links: string[] };

function isPhone(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 13) return false;
  return !YEAR_RANGE_RE.test(candidate.trim());
}

export function redactContact(text: string): string {
  return text
    .replace(EMAIL_RE, "[EMAIL]")
    .replace(PHONE_RE, (m) => (isPhone(m) ? "[TELEFONE]" : m));
}

export function extractContact(text: string): Contact {
  const email = text.match(EMAIL_RE)?.[0] ?? null;
  const phone = (text.match(PHONE_RE) ?? []).find(isPhone)?.trim() ?? null;
  const links: string[] = [];
  for (const raw of text.match(URL_RE) ?? []) {
    const cleaned = raw.replace(/[.,;:!?]+$/, "");
    const href = /^www\./i.test(cleaned) ? `https://${cleaned}` : cleaned;
    try {
      const u = new URL(href);
      if ((u.protocol === "https:" || u.protocol === "http:") && !links.includes(href)) links.push(href);
    } catch {
      // URL inválida: ignora.
    }
  }
  return { email, phone, links };
}
