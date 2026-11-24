import { NextResponse, type NextRequest } from "next/server";
import { AI_CSP_HOSTS } from "./lib/shared/ai-hosts";
import { buildNonceCsp } from "./lib/shared/csp";

/**
 * CSP com nonce por requisição nas rotas `(local)` (D-15, fallback aprovado):
 * o Next lê o header da *requisição* para aplicar o nonce aos seus scripts.
 */
export function proxy(request: NextRequest) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...bytes));
  const csp = buildNonceCsp(AI_CSP_HOSTS, nonce, {
    dev: process.env.NODE_ENV === "development",
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

// Só as rotas (local) (manter em sincronia com LOCAL_PATHS do next.config.ts); `:path*` cobre zero ou
// mais segmentos, o mesmo conjunto que a CSP estática exclui. Sem `missing` de prefetch: as rotas
// são dinâmicas e um <link rel=prefetch> pode buscar o HTML, que precisa vir com a CSP.
// NUNCA incluir /api/*: o segredo do cron é verificado no route handler (D-15, CVE-2025-29927).
// O Next exige o `config` como literal estático (não aceita variáveis).
export const config = {
  matcher: [
    "/perfil/:path*",
    "/configuracoes/:path*",
    "/gerador/:path*",
    "/minhas-vagas/:path*",
  ],
};
