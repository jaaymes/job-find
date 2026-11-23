import "client-only";

// Minimização de dados (D-11): e-mail e telefone nunca vão ao modelo de IA.
// Quantificadores limitados em tudo: sem backtracking quadrático em 30k caracteres.
const EMAIL_RE =
  /[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){0,8}\.\p{L}{2,24}/gu;
// Telefone: +DDI opcional, blocos de dígitos separados por espaço, "." ou "-" (com espaços ao redor).
const PHONE_RE =
  /(?<![\p{L}\p{N}+])\+?\(?\d{1,15}\)?(?:(?:\s*[.-]\s*|\s)\(?\d{1,15}\)?){0,7}(?![\p{L}\p{N}])/gu;
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"')\]]{1,2000}/gi;
// Para proteção contra redação: URL com esquema/www ou domínio nu seguido de caminho ("linkedin.com/in/ana-123").
const PROTECT_RE =
  /(?:https?:\/\/|www\.)[^\s<>"')\]]{1,2000}|(?:[\p{L}\p{N}-]{1,63}\.){1,5}[a-z]{2,24}\/[^\s<>"')\]]{0,2000}/giu;
const YEAR_RANGE_RE = /^(?:19|20)\d{2}\s*[-–/]\s*(?:19|20)\d{2}$/;

export type Contact = { email: string | null; phone: string | null; links: string[] };

function isPhone(candidate: string): boolean {
  const c = candidate.trim();
  const digits = c.replace(/\D/g, "").length;
  if (digits < 8 || digits > 15 || YEAR_RANGE_RE.test(c)) return false;
  // Só espaços entre blocos, sem "+", parênteses ou "-"/".": exige formato BR (10-11 dígitos).
  const weak = !/[+().-]/.test(c) && /\s/.test(c);
  return !weak || digits === 10 || digits === 11;
}

/** Troca os trechos de URL por marcadores para que números dentro delas não sejam alterados. */
function protectUrls(text: string): { text: string; restore: (s: string) => string } {
  const urls: string[] = [];
  const masked = text.replace(PROTECT_RE, (m) => `\u0000${urls.push(m) - 1}\u0000`);
  return { text: masked, restore: (s) => s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => urls[Number(i)] ?? "") };
}

/** Posições [início, fim) dos telefones válidos; reduz candidatos gulosos demais ("2020 2026 (11) 98888-7777"). */
function phoneSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of text.matchAll(PHONE_RE)) {
    const base = m.index ?? 0;
    // Peças separadas por espaço, com a posição de cada uma dentro do candidato.
    const pieces: Array<{ s: number; e: number }> = [];
    for (const p of m[0].matchAll(/\S+/g)) pieces.push({ s: p.index ?? 0, e: (p.index ?? 0) + p[0].length });
    let i = 0;
    while (i < pieces.length) {
      // Um ano solto no início ("2020 2026 (11) ...") não faz parte do telefone.
      if (i < pieces.length - 1 && /^(?:19|20)\d{2}$/.test(m[0].slice(pieces[i].s, pieces[i].e))) {
        i++;
        continue;
      }
      let hit = -1;
      for (let j = pieces.length - 1; j >= i; j--) {
        if (isPhone(m[0].slice(pieces[i].s, pieces[j].e))) {
          hit = j;
          break;
        }
      }
      if (hit < 0) {
        i++;
        continue;
      }
      spans.push([base + pieces[i].s, base + pieces[hit].e]);
      i = hit + 1;
    }
  }
  return spans;
}

export function redactContact(text: string): string {
  const { text: masked, restore } = protectUrls(text);
  const noEmail = masked.replace(EMAIL_RE, "[EMAIL]");
  let out = "";
  let last = 0;
  for (const [s, e] of phoneSpans(noEmail)) {
    out += noEmail.slice(last, s) + "[TELEFONE]";
    last = e;
  }
  return restore(out + noEmail.slice(last));
}

export function extractContact(text: string): Contact {
  const { text: masked } = protectUrls(text);
  const email = masked.match(EMAIL_RE)?.[0] ?? null;
  const span = phoneSpans(masked)[0];
  const phone = span ? masked.slice(span[0], span[1]) : null;
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
