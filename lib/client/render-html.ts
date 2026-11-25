import "client-only";
import DOMPurify from "dompurify";
import {
  ALLOWED_ATTRIBUTES,
  ALLOWED_HREF,
  ALLOWED_TAGS,
  DISCARD_CONTENT_TAGS,
  REL_DOFOLLOW,
  REL_NOFOLLOW,
} from "@/lib/shared/sanitize-policy";

// `rel` nunca vem do HTML de entrada: não está em ALLOWED_ATTR e é sempre
// definido aqui, a partir da opção (chamada síncrona, sem concorrência).
let currentRel = REL_NOFOLLOW;
let hookInstalled = false;

// Registrado na primeira chamada, não ao importar: o módulo também é avaliado no SSR do shell,
// onde não há `window` e o DOMPurify não expõe `addHook`.
function installHook(): void {
  if (hookInstalled) return;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "A") node.setAttribute("rel", currentRel);
  });
  hookInstalled = true;
}

const BLOCK_START = /^<(p|ul|ol|li|h[1-6]|blockquote|pre|div|table)[\s>]/i;

/** Texto corrido sem `<p>`: cada trecho separado por linha em branco vira um parágrafo. */
function wrapParagraphs(html: string): string {
  if (!/\n\s*\n/.test(html)) return html;
  return html
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => (BLOCK_START.test(chunk) ? chunk : `<p>${chunk}</p>`))
    .join("");
}

/**
 * Segunda camada de sanitização (SEC-02): roda no navegador antes de renderizar,
 * com a mesma allowlist do servidor (lib/shared/sanitize-policy.ts).
 */
export function toSafeHtml(html: string, opts: { dofollow?: boolean; paragraphs?: boolean } = {}): string {
  installHook();
  currentRel = opts.dofollow ? REL_DOFOLLOW : REL_NOFOLLOW;
  return DOMPurify.sanitize(opts.paragraphs ? wrapParagraphs(html) : html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTRIBUTES],
    ALLOWED_URI_REGEXP: ALLOWED_HREF,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    KEEP_CONTENT: true,
    FORBID_CONTENTS: [...DISCARD_CONTENT_TAGS],
  });
}
