import { describe, expect, it } from "vitest";
import { AI_CSP_HOSTS } from "../../../lib/shared/ai-hosts";
import { buildCsp, buildNonceCsp, buildSecurityHeaders } from "../../../lib/shared/csp";

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

describe("buildNonceCsp (rotas (local))", () => {
  const nonce = "dGVzdGUtbm9uY2U=";
  const csp = buildNonceCsp(AI_CSP_HOSTS, nonce);

  it("script-src com nonce e strict-dynamic, sem unsafe-inline nem unsafe-eval", () => {
    const script = directive(csp, "script-src").split(" ");
    expect(script).toEqual(["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]);
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("só adiciona unsafe-eval em desenvolvimento", () => {
    const dev = buildNonceCsp(AI_CSP_HOSTS, nonce, { dev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
  });

  it("mantém todas as demais diretivas iguais às da CSP estática", () => {
    const others = (c: string) => c.split("; ").filter((d) => !d.startsWith("script-src"));
    expect(others(csp)).toEqual(others(buildCsp(AI_CSP_HOSTS)));
    expect(directive(csp, "connect-src").split(" ")).toEqual(
      directive(buildCsp(AI_CSP_HOSTS), "connect-src").split(" "),
    );
  });

  it("muda o nonce a cada chamada com nonces diferentes", () => {
    expect(buildNonceCsp(AI_CSP_HOSTS, "AAAA")).not.toBe(buildNonceCsp(AI_CSP_HOSTS, "BBBB"));
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
    buildSecurityHeaders().map((h) => [h.key, h.value]),
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
    // A CSP sai em entrada separada no next.config (não vale para as rotas (local)).
    expect(headers["Content-Security-Policy"]).toBeUndefined();
  });
});

describe("next.config headers()", () => {
  it("aplica os headers da SEC-07 em todas as rotas e a CSP estática só fora de (local), com SRI ativo", async () => {
    const { default: config } = await import("../../../next.config");
    const rules = await config.headers?.();
    const rule = rules?.find((r) => r.source === "/(.*)");
    const keys = rule?.headers.map((h) => h.key) ?? [];
    expect(keys).not.toContain("Content-Security-Policy");
    const cspRule = rules?.find((r) => r.headers.some((h) => h.key === "Content-Security-Policy"));
    expect(cspRule?.source).toMatch(/^\/\(\(\?!/);
    const excluded = new RegExp(`^/${cspRule?.source.slice(1)}$`);
    for (const path of ["/perfil", "/configuracoes", "/configuracoes/callback", "/gerador/abc", "/minhas-vagas"]) {
      expect(excluded.test(path), path).toBe(false);
    }
    for (const path of ["/", "/vagas/1", "/fontes", "/perfilx"]) {
      expect(excluded.test(path), path).toBe(true);
    }
    for (const key of [
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
    const csp = cspRule?.headers.find((h) => h.key === "Content-Security-Policy");
    expect(csp?.value).not.toContain("'unsafe-eval'");
  });
});

describe("proxy.ts matcher", () => {
  it("cobre só os caminhos (local), ignora prefetch e nunca /api", async () => {
    const { config } = await import("../../../proxy");
    const entries = config.matcher as { source: string; missing?: { key: string }[] }[];
    const sources = entries.map((e) => e.source);
    expect(sources).toEqual(["/perfil", "/configuracoes/:path*", "/gerador/:path*", "/minhas-vagas"]);
    for (const e of entries) {
      expect(e.missing?.map((m) => m.key)).toEqual(["next-router-prefetch", "purpose"]);
    }
    expect(sources.join(" ")).not.toContain("api");
  });
});
