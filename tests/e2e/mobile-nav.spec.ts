import { expect, test } from "@playwright/test";
import { listJobs } from "@/lib/server/jobs/query";
import { parseJobsQuery } from "@/lib/shared/schemas/jobs-query";
import { MINUTE, seedDatabase, type E2eDb } from "./seed";

let db: E2eDb;
let closeDb: () => Promise<void>;

test.beforeAll(async () => {
  ({ db, close: closeDb } = await seedDatabase());
});

test.afterAll(async () => {
  await closeDb();
});

test.beforeEach(async ({ page }) => {
  // Mesmo mock de home.spec: o handler real roda sobre o banco semeado (neon-http não fala com o Postgres local).
  await page.route("**/api/jobs*", async (route) => {
    const parsed = parseJobsQuery(new URL(route.request().url()).searchParams);
    if (!parsed.ok) return route.fulfill({ status: 400, json: { error: parsed.error } });
    const result = await listJobs(db, parsed.value, !parsed.value.cursor);
    return route.fulfill({ json: { ...result, lastCollectedAt: new Date(Date.now() - 10 * MINUTE).toISOString() } });
  });
});

test("barra de abas visível e header de uma linha", async ({ page }) => {
  await page.goto("/");
  const tabBar = page.getByRole("navigation", { name: "Navegação inferior" });
  await expect(tabBar).toBeVisible();
  // Quatro destinos: Vagas, Minhas vagas, Perfil (links) e Mais (botão que abre o menu).
  await expect(tabBar.getByRole("link")).toHaveCount(3);
  await expect(tabBar.getByRole("button", { name: "Mais" })).toBeVisible();
  const header = await page.locator("header").first().boundingBox();
  expect(header).not.toBeNull();
  expect(header!.height).toBeLessThanOrEqual(56);
});

test("aba Perfil abre /perfil sem violação de CSP", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (/content security policy|refused to (load|apply|execute|connect)/i.test(msg.text())) problems.push(msg.text());
  });
  page.on("pageerror", (err) => problems.push(err.message));
  await page.addInitScript(() => {
    (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __cspViolations: string[] }).__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Navegação inferior" }).getByRole("link", { name: "Perfil" }).click();
  await expect(page).toHaveURL(/\/perfil$/);
  await expect(page.getByRole("heading", { name: "Seu perfil" })).toBeVisible();

  const violations = await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
  expect(violations).toEqual([]);
  expect(problems).toEqual([]);
});

test("primeiro card visível sem rolar (RF-01)", async ({ page }) => {
  await page.goto("/");
  const first = page.locator("article").first();
  await expect(first).toBeVisible();
  const box = await first.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + 120).toBeLessThan(844);
});
