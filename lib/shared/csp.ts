export type SecurityHeader = { key: string; value: string };

type CspOptions = {
  /** Só em `next dev`: o React usa eval para reconstruir stacks no navegador. */
  dev?: boolean;
};

/** Diretivas comuns à CSP estática e à CSP com nonce: só o `script-src` muda. */
function buildDirectives(aiHosts: string[], scriptSrc: string[]): string {
  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${["'self'", ...aiHosts].join(" ")}`,
    "worker-src 'self' blob:",
    "frame-src blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/**
 * CSP estática das rotas públicas (D-15: hash/SRI, sem nonce, para manter as páginas estáticas).
 * `style-src 'unsafe-inline'` fica só nos estilos (Tailwind, next/font e sonner
 * injetam <style>). Scripts nunca recebem 'unsafe-inline' nas rotas `(local)`.
 */
export function buildCsp(aiHosts: string[], options: CspOptions = {}): string {
  // DÍVIDA REMANESCENTE (rotas públicas): o SRI não cobre os scripts inline do
  // Next (bootstrap do Turbopack e payload RSC), então aqui o script-src ainda
  // precisa de 'unsafe-inline'. Isso é aceitável porque as rotas públicas não
  // guardam dados pessoais. As rotas `(local)` (perfil, configurações, gerador,
  // minhas vagas) já usam nonce + 'strict-dynamic' (buildNonceCsp, via proxy.ts).
  // 'strict-dynamic' fica de fora aqui de propósito: com ele os navegadores
  // ignoram 'unsafe-inline' e a hidratação das páginas estáticas quebraria.
  const scriptSrc = ["'self'", "'unsafe-inline'"];
  if (options.dev) scriptSrc.push("'unsafe-eval'");
  return buildDirectives(aiHosts, scriptSrc);
}

/** CSP das rotas `(local)`: nonce por requisição + 'strict-dynamic', sem 'unsafe-inline' nos scripts. */
export function buildNonceCsp(
  aiHosts: string[],
  nonce: string,
  options: CspOptions = {},
): string {
  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (options.dev) scriptSrc.push("'unsafe-eval'");
  return buildDirectives(aiHosts, scriptSrc);
}

/** Header da CSP estática (rotas públicas). */
export function buildCspHeader(
  aiHosts: string[],
  options: CspOptions = {},
): SecurityHeader {
  return { key: "Content-Security-Policy", value: buildCsp(aiHosts, options) };
}

/** Headers da SEC-07 (D-15) válidos em todas as rotas, sem a CSP. Sem CORS: nada de Access-Control-*. */
export function buildSecurityHeaders(): SecurityHeader[] {
  return [
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value:
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), interest-cohort=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "X-Frame-Options", value: "DENY" },
  ];
}
