import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": resolve(import.meta.dirname),
  // "server-only" lança fora do bundler do Next; nos testes vira um módulo vazio.
  "server-only": resolve(import.meta.dirname, "tests/stubs/empty.ts"),
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
        resolve: { alias },
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
    ],
  },
});
