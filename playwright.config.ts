import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  // Aliases só dos testes: `server-only`/`client-only` viram módulos vazios fora do bundler do Next.
  tsconfig: "tests/e2e/tsconfig.json",
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:3100" },
  // Porta própria (3100): evita reaproveitar, por engano, outro servidor de desenvolvimento na 3000.
  // Em CI o workflow já rodou `pnpm build` no passo anterior: aqui só sobe o servidor (um build só).
  webServer: {
    command: process.env.CI ? "exec next start -p 3100" : "pnpm build && exec next start -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
