import "client-only";
import DOMPurify from "dompurify";
import {
  ALLOWED_ATTRIBUTES,
  ALLOWED_HREF,
  ALLOWED_TAGS,
  DISCARD_CONTENT_TAGS,
  REL_NOFOLLOW,
} from "@/lib/shared/sanitize-policy";

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.nodeName === "A") node.setAttribute("rel", REL_NOFOLLOW);
});

/**
 * Segunda camada de sanitização (SEC-02): roda no navegador antes de renderizar,
 * com a mesma allowlist do servidor (lib/shared/sanitize-policy.ts).
 */
export function toSafeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTRIBUTES, "rel"],
    ALLOWED_URI_REGEXP: ALLOWED_HREF,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    KEEP_CONTENT: true,
    FORBID_CONTENTS: [...DISCARD_CONTENT_TAGS],
  });
}
