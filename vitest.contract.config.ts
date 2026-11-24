import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Contratos contra as APIs reais (rede): ficam fora de `vitest.config.ts` para que um `vitest run` sem filtro
// nunca saia para a internet. Rodam por `pnpm test:contract` e pelo workflow diário (contracts.yml).
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname),
      "server-only": resolve(import.meta.dirname, "tests/stubs/empty.ts"),
      "client-only": resolve(import.meta.dirname, "tests/stubs/empty.ts"),
    },
  },
  test: {
    name: "contract",
    include: ["tests/contract/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
  },
});
