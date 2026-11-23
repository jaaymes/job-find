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

// Endereço (D-11): logradouro brasileiro com número, CEP e formato inglês "123 Main St". Heurística conservadora:
// exige número depois do nome da rua; quantificadores limitados (sem backtracking quadrático). Cidade/estado ficam.
// Número do endereço: marcador opcional ("nº", "n.º", "No.", "número"), sem ano (19xx/20xx) e com milhar ("1.234").
const STREET_TAIL = String.raw`[^\n,;|()]{1,60}?,?[ \t]*(?:(?:n[.º°o]{1,2}|número|numero)[ \t]*)?(?<!\d)(?!(?:19|20)\d\d(?!\d))(?:\d{1,3}(?:\.\d{3})+|\d{1,5})(?!\d|[ \t]*[-–/][ \t]*\d{4})(?:[ \t]*[-,][ \t]*(?:apto?\.?|ap\.?|apartamento|bloco|sala|conj\.?|casa)[ \t]*\w{1,6})?`;
const STREET_HEAD = String.raw`(?<![\p{L}\p{N}])`;
// Palavras inteiras sem diferenciar caixa; abreviações só com a inicial maiúscula ("et al. 3 papers" não casa).
const STREET_BR_RE = new RegExp(
  `${STREET_HEAD}(?:Rua|Avenida|Travessa|Alameda|Rodovia|Estrada|Pra[çc]a|Largo)[ \\t]+${STREET_TAIL}`,
  "giu",
);
const STREET_BR_ABBR_RE = new RegExp(`${STREET_HEAD}(?:R|Av|Tv|Al|Rod)\\.[ \\t]+${STREET_TAIL}`, "gu");
const STREET_EN_RE =
  /(?<![\p{L}\p{N}])\d{1,5}[ \t]+(?:[A-Z][\p{L}.'-]{0,20}[ \t]+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr)\b\.?/gu;
const CEP_RE = /(?<![\p{L}\p{N}])(?:CEP:?[ \t]*\d{5}-?\d{3}|\d{5}-\d{3})(?!\d)/giu;

function redactAddress(text: string): string {
  return text
    .replace(STREET_BR_RE, "[ENDERECO]")
    .replace(STREET_BR_ABBR_RE, "[ENDERECO]")
    .replace(STREET_EN_RE, "[ENDERECO]").replace(CEP_RE, "[ENDERECO]");
}

export type Contact = { email: string | null; phone: string | null; links: string[] };

function isPhone(candidate: string): boolean {
  const c = candidate.trim();
  const digits = c.replace(/\D/g, "").length;
  if (digits < 8 || digits > 15 || YEAR_RANGE_RE.test(c)) return false;
  // Só espaços entre blocos, sem "+", parênteses ou "-"/".": exige formato BR (10-11 dígitos).
  const weak = !/[+().-]/.test(c) && /\s/.test(c);
  return !weak || digits === 10 || digits === 11;
}

const WA_HOST_RE = /wa\.me|whatsapp/i;
const PHONE_PARAM_RE = /([?&](?:phone|tel|fone|whatsapp|celular)=\+?)\d{8,}/gi;

/** Redige números de telefone dentro de uma URL (wa.me, whatsapp, parâmetros de telefone ou 10+ dígitos). */
function redactUrl(url: string): string {
  const host = /^(?:https?:\/\/)?([^/?#:]+)/i.exec(url)?.[1] ?? "";
  const withParam = url.replace(PHONE_PARAM_RE, "$1[TELEFONE]");
  // Outras URLs (ex.: linkedin.com/in/ana-98888777) só perdem sequências longas de dígitos.
  return withParam.replace(WA_HOST_RE.test(host) ? /\+?\d{8,}/g : /\d{10,}/g, "[TELEFONE]");
}

/** Troca os trechos de URL por marcadores (um caractere PUA com o índice, entre NULs). */
function protectUrls(text: string): { text: string; restore: (s: string) => string } {
  const urls: string[] = [];
  // NUL não tem valor num CV e serve de delimitador: remove os que já existam.
  const masked = text
    .replace(/\u0000/g, "")
    .replace(PROTECT_RE, (m) =>
      urls.length < 6000 ? `\u0000${String.fromCharCode(0xe000 + urls.push(m) - 1)}\u0000` : m,
    );
  return {
    text: masked,
    restore: (s) => s.replace(/\u0000([\uE000-\uF8FF])\u0000/g, (_, c: string) => redactUrl(urls[c.charCodeAt(0) - 0xe000] ?? "")),
  };
}

// Períodos "01.2020 - 12.2023", "03-2019", "1999 - 2003": viram filler para não serem lidos como telefone.
const MY = String.raw`(?:(?:0?[1-9]|1[0-2])[./-])?(?:19|20)\d{2}(?!\d)`;
const DATE_RE = new RegExp(
  String.raw`(?<!\d)${MY}\s*[-–—]\s*${MY}|(?<!\d)(?:0?[1-9]|1[0-2])[./-](?:19|20)\d{2}(?!\d)`,
  "g",
);
const maskDates = (t: string) => t.replace(DATE_RE, (m) => "\u0001".repeat(m.length));

/** Posições [início, fim) dos telefones válidos; reduz candidatos gulosos demais ("2020 2026 (11) 98888-7777"). */
function phoneSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const m of maskDates(text).matchAll(PHONE_RE)) {
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
  const noEmail = redactAddress(masked.replace(EMAIL_RE, "[EMAIL]"));
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
