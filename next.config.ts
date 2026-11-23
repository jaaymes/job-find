import type { NextConfig } from "next";
import { AI_CSP_HOSTS } from "./lib/shared/ai-hosts";
import { buildSecurityHeaders } from "./lib/shared/csp";

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
      {
        source: "/(.*)",
        headers: buildSecurityHeaders(AI_CSP_HOSTS, {
          dev: process.env.NODE_ENV === "development",
        }),
      },
    ];
  },
};

export default nextConfig;
