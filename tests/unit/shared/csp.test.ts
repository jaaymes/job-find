import { describe, expect, it } from "vitest";
import { AI_CSP_HOSTS } from "../../../lib/shared/ai-hosts";
import { buildCsp, buildSecurityHeaders } from "../../../lib/shared/csp";

function directive(csp: string, name: string): string {
  const found = csp.split("; ").find((d) => d === name || d.startsWith(`${name} `));
  if (!found) throw new Error(`diretiva ausente: ${name}`);
  return found;
}

describe("buildCsp", () => {
  const csp = buildCsp(AI_CSP_HOSTS);

  it("bloqueia object, frames de terceiros e base-uri", () => {
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("libera os provedores de IA no connect-src, nunca https: genérico", () => {
    expect(csp).toMatch(/connect-src 'self' .*https:\/\/openrouter\.ai/);
    expect(csp).not.toMatch(/connect-src[^;]* https: /);
    const connect = directive(csp, "connect-src").split(" ");
    expect(connect).not.toContain("https:");
    expect(connect).not.toContain("*");
    for (const host of AI_CSP_HOSTS) expect(connect).toContain(host);
  });

  it("sem unsafe-eval em produção e sem strict-dynamic junto de unsafe-inline", () => {
    expect(csp).not.toContain("'unsafe-eval'");
    const script = directive(csp, "script-src");
    expect(script).toContain("'unsafe-inline'"); // dívida da Fase 1, ver csp.ts
    expect(script).not.toContain("'strict-dynamic'");
  });

  it("só adiciona unsafe-eval ao script-src em desenvolvimento", () => {
    const dev = buildCsp(AI_CSP_HOSTS, { dev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(buildCsp(AI_CSP_HOSTS, { dev: false })).not.toContain("'unsafe-eval'");
  });

  it("libera https: só em img-src (logos das empresas)", () => {
    expect(directive(csp, "img-src")).toContain("https:");
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
  });

  it("é determinística e separada por '; '", () => {
    expect(buildCsp(AI_CSP_HOSTS)).toBe(buildCsp([...AI_CSP_HOSTS]));
    expect(csp).not.toMatch(/;$/);
  });
});

describe("AI_CSP_HOSTS", () => {
  it("só tem origens (esquema + host), sem curinga amplo nem https: puro", () => {
    for (const host of AI_CSP_HOSTS) {
      expect(host).toMatch(/^https?:\/\/[a-z0-9.-]+(:(\d+|\*))?$/);
    }
  });
});

describe("buildSecurityHeaders (SEC-07)", () => {
  const headers = Object.fromEntries(
    buildSecurityHeaders(AI_CSP_HOSTS).map((h) => [h.key, h.value]),
  );

  it("inclui os headers de segurança com os valores da D-15", () => {
    expect(headers["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains",
    );
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Content-Security-Policy"]).toBe(buildCsp(AI_CSP_HOSTS));
  });
});

describe("next.config headers()", () => {
  it("aplica CSP e headers da SEC-07 em todas as rotas, com SRI ativo", async () => {
    const { default: config } = await import("../../../next.config");
    const rules = await config.headers?.();
    const rule = rules?.find((r) => r.source === "/(.*)");
    const keys = rule?.headers.map((h) => h.key) ?? [];
    for (const key of [
      "Content-Security-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Cross-Origin-Opener-Policy",
      "X-Frame-Options",
    ]) {
      expect(keys).toContain(key);
    }
    expect(keys).not.toContain("Cache-Control");
    expect(config.experimental?.sri?.algorithm).toBe("sha256");
    const csp = rule?.headers.find((h) => h.key === "Content-Security-Policy");
    expect(csp?.value).not.toContain("'unsafe-eval'");
  });
});
