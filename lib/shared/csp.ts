export type SecurityHeader = { key: string; value: string };

type CspOptions = {
  /** Só em `next dev`: o React usa eval para reconstruir stacks no navegador. */
  dev?: boolean;
};

/**
 * Monta a CSP da D-15 (hash/SRI, sem nonce, para manter as páginas estáticas).
 * `style-src 'unsafe-inline'` fica só nos estilos (Tailwind, next/font e sonner
 * injetam <style>). Scripts nunca recebem 'unsafe-inline'.
 */
export function buildCsp(aiHosts: string[], options: CspOptions = {}): string {
  // DÍVIDA DELIBERADA DA FASE 1: o SRI não cobre os scripts inline do Next
  // (bootstrap do Turbopack e payload RSC), então o script-src precisa de
  // 'unsafe-inline'. 'strict-dynamic' fica de fora de propósito: com ele os
  // navegadores ignoram 'unsafe-inline' e a hidratação quebraria. Antes de
  // chegarem segredos (Fase 2, rotas `(local)`), o fallback da D-15 (nonce nas
  // rotas `(local)`) ou hashes gerados no build devem substituir 'unsafe-inline'.
  const scriptSrc = ["'self'", "'unsafe-inline'"];
  if (options.dev) scriptSrc.push("'unsafe-eval'");

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

/** CSP + headers da SEC-07 (D-15). Sem CORS: nada de Access-Control-*. */
export function buildSecurityHeaders(
  aiHosts: string[],
  options: CspOptions = {},
): SecurityHeader[] {
  return [
    { key: "Content-Security-Policy", value: buildCsp(aiHosts, options) },
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
