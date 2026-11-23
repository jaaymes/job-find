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

// Só as rotas (local) (manter em sincronia com LOCAL_PATHS do next.config.ts), sem prefetch.
// NUNCA incluir /api/*: o segredo do cron é verificado no route handler (D-15, CVE-2025-29927).
// O Next exige o `config` como literal estático (não aceita variáveis), por isso a repetição.
export const config = {
  matcher: [
    {
      source: "/perfil",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    {
      source: "/configuracoes/:path*",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    {
      source: "/gerador/:path*",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
    {
      source: "/minhas-vagas",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
