import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { THEME_SCRIPT, THEME_SCRIPT_HASH, THEME_STORAGE_KEY } from "../../../lib/shared/theme-script";

type FakeEnv = { stored?: string | null; throwStorage?: boolean; systemDark?: boolean; noMatchMedia?: boolean };

function run(env: FakeEnv) {
  const classes = new Set<string>();
  const html = {
    classList: {
      toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
    },
    style: { colorScheme: "" },
  };
  const localStorage = {
    getItem: (k: string) => {
      if (env.throwStorage) throw new Error("SecurityError");
      return k === THEME_STORAGE_KEY ? (env.stored ?? null) : null;
    },
  };
  const window = {
    localStorage,
    matchMedia: env.noMatchMedia ? undefined : (q: string) => ({ matches: q === "(prefers-color-scheme: dark)" && !!env.systemDark }),
  };
  runInNewContext(THEME_SCRIPT, { window, localStorage, document: { documentElement: html } });
  return { dark: classes.has("dark"), scheme: html.style.colorScheme };
}

describe("THEME_SCRIPT", () => {
  it("a chave do localStorage é jf-theme", () => {
    expect(THEME_STORAGE_KEY).toBe("jf-theme");
  });

  it("o hash fixado bate com o sha256 do script", () => {
    const h = createHash("sha256").update(THEME_SCRIPT, "utf8").digest("base64");
    expect(THEME_SCRIPT_HASH).toBe(`'sha256-${h}'`);
  });

  it("preferência salva vence o sistema", () => {
    expect(run({ stored: "dark", systemDark: false })).toEqual({ dark: true, scheme: "dark" });
    expect(run({ stored: "light", systemDark: true })).toEqual({ dark: false, scheme: "light" });
  });

  it("sem preferência (ou 'system' ou valor inválido) segue o sistema", () => {
    expect(run({ systemDark: true })).toEqual({ dark: true, scheme: "dark" });
    expect(run({ stored: "system", systemDark: false })).toEqual({ dark: false, scheme: "light" });
    expect(run({ stored: "roxo", systemDark: true })).toEqual({ dark: true, scheme: "dark" });
  });

  it("localStorage que lança e matchMedia ausente não quebram", () => {
    expect(run({ throwStorage: true, systemDark: true })).toEqual({ dark: true, scheme: "dark" });
    expect(() => run({ throwStorage: true, noMatchMedia: true })).not.toThrow();
    expect(run({ noMatchMedia: true })).toEqual({ dark: false, scheme: "light" });
  });
});
