import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it } from "vitest";
import { AI_CSP_HOSTS } from "../../../lib/shared/ai-hosts";
import { buildCsp, buildNonceCsp, buildSecurityHeaders } from "../../../lib/shared/csp";
import { THEME_SCRIPT_HASH } from "../../../lib/shared/theme-script";

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

  it("script-src com nonce, strict-dynamic e wasm-unsafe-eval, sem unsafe-inline nem unsafe-eval", () => {
    const script = directive(csp, "script-src").split(" ");
    expect(script).toEqual([
      "script-src",
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      "'wasm-unsafe-eval'",
      THEME_SCRIPT_HASH,
    ]);
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
  });

  it("a CSP estática das rotas públicas não tem wasm-unsafe-eval", () => {
    expect(buildCsp(AI_CSP_HOSTS)).not.toContain("wasm-unsafe-eval");
    expect(buildCsp(AI_CSP_HOSTS, { dev: true })).not.toContain("wasm-unsafe-eval");
  });

  it("só adiciona unsafe-eval em desenvolvimento", () => {
    const dev = buildNonceCsp(AI_CSP_HOSTS, nonce, { dev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
  });

  it("mantém todas as demais diretivas iguais às da CSP estática", () => {
    const others = (c: string) =>
      c.split("; ").filter((d) => !d.startsWith("script-src") && !d.startsWith("connect-src"));
    expect(others(csp)).toEqual(others(buildCsp(AI_CSP_HOSTS)));
  });

  it("connect-src = o da estática + data: (WASM do yoga-layout), só nas rotas (local)", () => {
    const local = directive(csp, "connect-src").split(" ");
    const pub = directive(buildCsp(AI_CSP_HOSTS), "connect-src").split(" ");
    expect(local).toContain("data:");
    expect(pub).not.toContain("data:");
    expect(local.filter((s) => s !== "data:")).toEqual(pub);
    expect(local).not.toContain("https:");
    expect(local).not.toContain("*");
    expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'");
  });

  it("a CSP com nonce libera o script de tema por hash", () => {
    expect(directive(buildNonceCsp([], "n"), "script-src")).toContain(THEME_SCRIPT_HASH);
    expect(directive(buildNonceCsp([], "n", { dev: true }), "script-src")).toContain(THEME_SCRIPT_HASH);
  });

  it("a CSP pública não leva hash (senão 'unsafe-inline' seria ignorado)", () => {
    expect(directive(buildCsp([]), "script-src")).not.toContain("sha256-");
    expect(directive(buildCsp([], { dev: true }), "script-src")).not.toContain("sha256-");
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

describe("proxy.ts matcher x CSP estática", () => {
  const compile = (source: string) => pathToRegexp(source);

  it("matcher literal cobre só os caminhos (local), sem /api", async () => {
    const { config } = await import("../../../proxy");
    expect(config.matcher).toEqual([
      "/perfil/:path*",
      "/configuracoes/:path*",
      "/gerador/:path*",
      "/minhas-vagas/:path*",
    ]);
  });

  it("exatamente uma CSP por caminho: excluído da estática <=> casado pelo proxy", async () => {
    const { config } = await import("../../../proxy");
    const { default: next } = await import("../../../next.config");
    const rules = await next.headers?.();
    const cspRule = rules?.find((r) => r.headers.some((h) => h.key === "Content-Security-Policy"));
    const staticCsp = compile(cspRule?.source ?? "");
    const proxyMatchers = (config.matcher as string[]).map(compile);

    const local = ["/perfil", "/perfil/x", "/configuracoes", "/configuracoes/callback", "/gerador/abc", "/minhas-vagas", "/minhas-vagas/x"];
    const publicPaths = ["/perfilx", "/", "/vagas/1", "/api/jobs"];
    for (const path of [...local, ...publicPaths]) {
      const byStatic = staticCsp.test(path);
      const byProxy = proxyMatchers.some((m) => m.test(path));
      expect(byStatic !== byProxy, `${path}: estática=${byStatic} proxy=${byProxy}`).toBe(true);
      expect(byProxy, path).toBe(local.includes(path));
    }
  });
});
