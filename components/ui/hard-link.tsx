import type { AnchorHTMLAttributes } from "react";

/** Rotas do grupo `(local)`: servidas com a CSP de nonce (com `'wasm-unsafe-eval'` e `data:` no `connect-src`). */
export type LocalRoute = "/perfil" | "/configuracoes" | `/gerador/${string}` | "/minhas-vagas";

/**
 * Link para uma rota `(local)` com navegação COMPLETA (um `<a>` comum, sem `next/link`).
 *
 * As rotas públicas e as `(local)` compartilham o layout raiz, então um `next/link` faria uma navegação no
 * cliente e o documento continuaria com a CSP pública (sem `'wasm-unsafe-eval'` nem `data:` no `connect-src`):
 * o PDF do gerador e outras telas locais quebrariam. A navegação completa busca o documento de novo e aplica a
 * CSP de nonce da rota local. Não troque por `next/link` e não afrouxe a CSP pública.
 */
export function HardLink({ href, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: LocalRoute }) {
  return <a href={href} {...rest} />;
}
