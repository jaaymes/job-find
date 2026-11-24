import "server-only";
import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";
import {
  ALLOWED_HREF,
  ALLOWED_SCHEMES,
  ALLOWED_TAGS,
  DISCARD_CONTENT_TAGS,
  MAX_HTML_BYTES,
  REL_DOFOLLOW,
  REL_NOFOLLOW,
} from "@/lib/shared/sanitize-policy";

export const SANITIZER_VERSION = 1;

function options(dofollow: boolean): sanitizeHtml.IOptions {
  const rel = dofollow ? REL_DOFOLLOW : REL_NOFOLLOW;
  return {
    allowedTags: [...ALLOWED_TAGS],
    allowedAttributes: { a: ["href", "rel"] },
    allowedSchemes: [...ALLOWED_SCHEMES],
    allowedSchemesAppliedToAttributes: ["href"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    nonTextTags: [...DISCARD_CONTENT_TAGS],
    transformTags: {
      // O `rel` vindo da fonte é sempre sobrescrito.
      a: (tagName, attribs) => ({
        tagName,
        attribs: { ...(attribs.href !== undefined && ALLOWED_HREF.test(attribs.href.trim())
          ? { href: attribs.href.trim() }
          : {}), rel },
      }),
    },
  };
}

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

/** Corta `html` em no máximo `limit` bytes, sem partir caractere, tag ou entidade. */
function cutAt(html: string, limit: number): string {
  let s = Buffer.from(html, "utf8").subarray(0, limit).toString("utf8").replace(/�+$/, "");
  const lt = s.lastIndexOf("<");
  if (lt > s.lastIndexOf(">")) s = s.slice(0, lt);
  const amp = s.lastIndexOf("&");
  if (amp !== -1 && amp > s.length - 12 && !s.slice(amp).includes(";")) s = s.slice(0, amp);
  return s;
}

/**
 * Sanitiza o HTML de uma vaga com a allowlist compartilhada e limita a saída a
 * 30.000 bytes. O truncamento é feito sobre o HTML já limpo e re-sanitizado, o
 * que fecha as tags abertas; o corte recua até a saída caber no limite.
 */
export function sanitizeJobHtml(html: string, opts: { dofollow: boolean }): string {
  const o = options(opts.dofollow);
  const full = sanitizeHtml(html, o);
  if (bytes(full) <= MAX_HTML_BYTES) return full;

  let limit = MAX_HTML_BYTES;
  for (let i = 0; i < 20; i++) {
    const out = sanitizeHtml(cutAt(full, limit), o);
    const size = bytes(out);
    if (size <= MAX_HTML_BYTES) return out;
    limit -= size - MAX_HTML_BYTES + 1;
    if (limit <= 0) break;
  }
  // Não convergiu (ex.: aninhamento patológico): degrada para texto puro em <p>.
  const text = htmlToText(html)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return sanitizeHtml(`<p>${cutAt(text, MAX_HTML_BYTES - 7)}</p>`, o);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// HTML cru dentro do markdown nunca passa: vira texto escapado.
const marked = new Marked({
  async: false,
  renderer: { html: (token) => escapeHtml(token.text) },
});

/** Markdown (issues do GitHub) para HTML seguro: sem HTML cru e sem dofollow. */
export function markdownToSafeHtml(md: string): string {
  return sanitizeJobHtml(marked.parse(md) as string, { dofollow: false });
}

const BLOCK_TAGS = /<\/?(?:p|br|li|ul|ol|h[1-6]|blockquote|pre|div|tr|td|th|table)\b[^>]*>/gi;

/** Texto puro: remove marcação, decodifica entidades e colapsa espaços. */
export function htmlToText(html: string): string {
  const escaped = sanitizeHtml(html.replace(BLOCK_TAGS, " "), {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: [...DISCARD_CONTENT_TAGS],
  });
  return escaped
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Resumo em texto, cortado em limite de palavra, com "…" contado dentro de `max`. */
export function summarize(html: string, max = 280): string {
  const text = htmlToText(html);
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  const cut = text[max - 1] === " " || space <= 0 ? head : head.slice(0, space);
  return `${cut.trimEnd()}…`;
}
