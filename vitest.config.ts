import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": resolve(import.meta.dirname),
  // "server-only" lança fora do bundler do Next; nos testes vira um módulo vazio.
  "server-only": resolve(import.meta.dirname, "tests/stubs/empty.ts"),
  // "client-only" também é fornecido pelo Next no build; nos testes vira um módulo vazio.
  "client-only": resolve(import.meta.dirname, "tests/stubs/empty.ts"),
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.{ts,tsx}"],
          exclude: ["tests/unit/client/**"],
          environment: "node",
        },
      },
      {
        // Mesmo projeto lógico "unit": testes de código client-side rodam em jsdom.
        // mammoth: o bundler do Next usa o build de navegador (campo "browser"); aqui o alias reproduz isso.
        resolve: {
          alias: { ...alias, mammoth: resolve(import.meta.dirname, "node_modules/mammoth/mammoth.browser.js") },
        },
        test: {
          name: "unit-client",
          include: ["tests/unit/client/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.{ts,tsx}"],
          environment: "node",
          fileParallelism: false,
        },
      },
      {
        // Contratos contra as APIs reais (rede): fora de `pnpm test` e `pnpm test:integration`
        // (que filtram por projeto); rodam por `pnpm test:contract` e pelo workflow diário.
        resolve: { alias },
        test: {
          name: "contract",
          include: ["tests/contract/**/*.test.ts"],
          environment: "node",
          testTimeout: 120_000,
        },
      },
    ],
  },
});
