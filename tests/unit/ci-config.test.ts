import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
const playwright = readFileSync(resolve(root, "playwright.config.ts"), "utf8");

/** Comandos `run:` do workflow, na ordem. */
const runs = [...ci.matchAll(/^\s*(?:-\s+)?run:\s*(.+)$/gm)].map((m) => m[1]!.trim());

describe("workflow de CI", () => {
  it("instala o Chromium do Playwright antes dos testes E2E", () => {
    const install = runs.findIndex((r) => /playwright install --with-deps chromium/.test(r));
    const e2e = runs.indexOf("pnpm test:e2e");
    expect(install).toBeGreaterThanOrEqual(0);
    expect(e2e).toBeGreaterThan(install);
  });

  it("faz um build só: o webServer do Playwright não rebuilda em CI", () => {
    expect(runs.filter((r) => r === "pnpm build")).toHaveLength(1);
    expect(runs.indexOf("pnpm build")).toBeLessThan(runs.indexOf("pnpm test:e2e"));
    expect(playwright).toMatch(/process\.env\.CI \? "exec next start -p 3100"/);
  });

  it("os E2E rodam com o banco de teste do serviço Postgres", () => {
    const e2eStep = ci.slice(ci.indexOf("run: pnpm test:e2e"));
    expect(e2eStep).toMatch(/DATABASE_URL: postgres:\/\/postgres:postgres@127\.0\.0\.1:54329\/jobfind_test/);
    expect(ci).toMatch(/54329:5432/);
  });
});
