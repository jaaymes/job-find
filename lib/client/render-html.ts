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

/**
 * Segunda camada de sanitização (SEC-02): roda no navegador antes de renderizar,
 * com a mesma allowlist do servidor (lib/shared/sanitize-policy.ts).
 */
export function toSafeHtml(html: string, opts: { dofollow?: boolean } = {}): string {
  installHook();
  currentRel = opts.dofollow ? REL_DOFOLLOW : REL_NOFOLLOW;
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTRIBUTES],
    ALLOWED_URI_REGEXP: ALLOWED_HREF,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    KEEP_CONTENT: true,
    FORBID_CONTENTS: [...DISCARD_CONTENT_TAGS],
  });
}
