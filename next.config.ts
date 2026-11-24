import type { NextConfig } from "next";
import { AI_CSP_HOSTS } from "./lib/shared/ai-hosts";
import { buildCspHeader, buildSecurityHeaders } from "./lib/shared/csp";

/** Primeiros segmentos das rotas do grupo `app/(local)`. */
const LOCAL_PATHS = ["perfil", "configuracoes", "gerador", "minhas-vagas"];

const nextConfig: NextConfig = {
  experimental: {
    // Hashes SRI gerados no build: CSP sem nonce, mantendo as páginas estáticas (D-15).
    sri: { algorithm: "sha256" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      // Headers de segurança em todas as rotas.
      { source: "/(.*)", headers: buildSecurityHeaders() },
      // CSP estática só fora das rotas (local): lá o proxy.ts manda a CSP com nonce
      // (um único header CSP por resposta). Manter a lista em sincronia com o matcher do proxy.ts.
      {
        source: `/((?!(?:${LOCAL_PATHS.join("|")})(?:/|$)).*)`,
        headers: [
          buildCspHeader(AI_CSP_HOSTS, {
            dev: process.env.NODE_ENV === "development",
          }),
        ],
      },
    ];
  },
};

export default nextConfig;
