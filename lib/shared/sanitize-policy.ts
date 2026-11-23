/**
 * Política única de sanitização do HTML das vagas (SEC-02).
 * Usada pelo servidor (sanitize-html, na ingestão) e pelo cliente (DOMPurify,
 * antes de renderizar), para que as duas camadas tenham a mesma allowlist.
 */

export const ALLOWED_TAGS = [
  "p",
  "br",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "b",
  "i",
  "h3",
  "h4",
  "h5",
  "h6",
  "code",
  "pre",
  "blockquote",
  "a",
] as const;

/** Único atributo vindo da fonte; o `rel` dos links é sempre gerado por nós. */
export const ALLOWED_ATTRIBUTES = ["href"] as const;

export const ALLOWED_SCHEMES = ["http", "https", "mailto"] as const;

/** Elementos cujo conteúdo é descartado por inteiro (não só a tag). */
export const DISCARD_CONTENT_TAGS = [
  "script",
  "style",
  "iframe",
  "svg",
  "object",
  "embed",
  "applet",
  "math",
  "template",
  "noscript",
  "noembed",
  "noframes",
  "frameset",
  "textarea",
  "select",
  "option",
  "title",
  "xmp",
  "plaintext",
  "head",
] as const;

export const REL_NOFOLLOW = "noopener noreferrer nofollow";
export const REL_DOFOLLOW = "noopener noreferrer";

/** Limite da saída sanitizada, em bytes UTF-8. */
export const MAX_HTML_BYTES = 30_000;

/** href aceito: esquema explícito da allowlist (links relativos e sem esquema são descartados). */
export const ALLOWED_HREF = new RegExp(`^(?:${ALLOWED_SCHEMES.join("|")}):`, "i");
