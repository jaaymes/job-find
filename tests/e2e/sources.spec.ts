import { expect, test } from "@playwright/test";
import { sql } from "drizzle-orm";
import { listSourcesStatus } from "@/lib/server/sources/status";
import { MINUTE, seedDatabase, type E2eDb } from "./seed";

const HOUR = 60 * MINUTE;

let db: E2eDb;
let closeDb: () => Promise<void>;
let problems: string[];

test.beforeAll(async () => {
  ({ db, close: closeDb } = await seedDatabase());
});

test.afterAll(async () => {
  await closeDb();
});

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on("console", (msg) => {
    if (/content security policy|refused to (load|apply|execute|connect)/i.test(msg.text())) problems.push(msg.text());
  });
  page.on("pageerror", (err) => problems.push(err.message));

  // `/api/sources/status` usa o driver neon-http, que não fala com o Postgres local: a consulta real roda aqui,
  // sobre o banco semeado por cada teste.
  await page.route("**/api/sources/status", async (route) => {
    return route.fulfill({ json: { sources: await listSourcesStatus(db) } });
  });
});

test.afterEach(() => {
  expect(problems, "sem violações de CSP nem erros de página").toEqual([]);
});

async function seedStates() {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  await db.execute(sql`TRUNCATE source_state, source_runs RESTART IDENTITY`);
  await db.execute(sql`INSERT INTO source_state (source, consecutive_failures, last_success_at) VALUES
    ('lever', 0, ${ago(10 * MINUTE)}),
    ('ashby', 0, ${ago(5 * HOUR)}),
    ('hn', 3, ${ago(10 * MINUTE)}),
    ('jobicy', 0, NULL)`);
  await db.execute(sql`INSERT INTO source_runs (source, started_at, status) VALUES
    ('lever', ${ago(10 * MINUTE)}, 'ok'),
    ('ashby', ${ago(5 * HOUR)}, 'ok'),
    ('hn', ${ago(10 * MINUTE)}, 'error'),
    ('jobicy', ${ago(30 * MINUTE)}, 'error')`);
}

test("Fontes lista todas as fontes com link de atribuição e rel correto", async ({ page }) => {
  await seedStates();
  await page.goto("/fontes");
  await expect(page.getByRole("heading", { level: 1, name: "Fontes" })).toBeVisible();
  await expect(page.locator("main li")).toHaveCount(9);

  const lever = page.getByRole("link", { name: "Lever" });
  await expect(lever).toHaveAttribute("href", "https://www.lever.co");
  await expect(lever).toHaveAttribute("rel", "noopener noreferrer nofollow");
  // RemoteOK é a única fonte dofollow.
  await expect(page.getByRole("link", { name: "Remote OK" })).toHaveAttribute("rel", "noopener noreferrer");
});

test("Fontes avisa coleta parada e destaca fonte falhando", async ({ page }) => {
  await seedStates();
  await page.goto("/fontes");
  const item = (name: string) => page.locator("main li").filter({ has: page.getByRole("link", { name, exact: true }) });

  // ashby: último sucesso há 5 h; jobicy: execuções sem nenhum sucesso.
  await expect(item("Ashby").getByText("Coleta parada há mais de 3 h")).toBeVisible();
  await expect(item("Jobicy").getByText("Coleta parada há mais de 3 h")).toBeVisible();
  // lever: em dia; GitHub: sem execuções ainda, não é "parada".
  await expect(item("Lever").getByText("Coleta parada há mais de 3 h")).toHaveCount(0);
  await expect(item("GitHub").getByText("Coleta parada há mais de 3 h")).toHaveCount(0);
  // hn: 3 falhas seguidas.
  await expect(item("Hacker News").getByText("Falhando")).toBeVisible();
  await expect(item("Lever").getByText("Falhando")).toHaveCount(0);
});

test("o rodapé leva a Fontes e a Privacidade", async ({ page }) => {
  await seedStates();
  await page.goto("/fontes");
  await page.getByRole("contentinfo").getByRole("link", { name: "Privacidade" }).click();
  await expect(page).toHaveURL(/\/privacidade$/);
  await expect(page.getByRole("heading", { level: 1, name: "Privacidade" })).toBeVisible();
});

test("Privacidade traz todas as seções e o placeholder de contato", async ({ page }) => {
  await page.goto("/privacidade");
  for (const name of [
    "Onde ficam os seus dados",
    "Envio ao provedor de IA que você escolher",
    "Transferência internacional de dados",
    "Logs de IP da Vercel",
    "Analytics",
    "Como apagar tudo",
    "Remoção de dados de terceiros em vagas",
  ]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  await expect(page.getByText("[EMAIL DE CONTATO]")).toBeVisible();
  await expect(page.getByText(/OpenRouter/)).toBeVisible();
  await expect(page.getByText(/DeepSeek/)).toBeVisible();
});
