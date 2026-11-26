import { expect, test, type Page } from "@playwright/test";
import { listJobs } from "@/lib/server/jobs/query";
import { parseJobsQuery } from "@/lib/shared/schemas/jobs-query";
import { MINUTE, seedDatabase, type E2eDb } from "./seed";

const HOUR = 60 * MINUTE;

let db: E2eDb;
let closeDb: () => Promise<void>;
/** Controlado pelo teste: o que `/api/jobs` devolve em `lastCollectedAt`. */
let lastCollectedAt: string | null;
/** Quando definido, `/api/jobs` responde 500 (estado de erro). */
let failApi = false;
let problems: string[];

test.beforeAll(async () => {
  ({ db, close: closeDb } = await seedDatabase());
});

test.afterAll(async () => {
  await closeDb();
});

test.beforeEach(async ({ page }) => {
  lastCollectedAt = new Date(Date.now() - 10 * MINUTE).toISOString();
  failApi = false;
  problems = [];
  // Violações de CSP aparecem no console; erros de página também contam.
  page.on("console", (msg) => {
    const text = msg.text();
    if (/content security policy|refused to (load|apply|execute|connect)/i.test(text)) problems.push(text);
  });
  page.on("pageerror", (err) => problems.push(err.message));

  // `/api/jobs` usa o driver neon-http, que não fala com o Postgres local: o handler real roda aqui,
  // com a query e o `listJobs` reais sobre o banco semeado.
  await page.route("**/api/jobs*", async (route) => {
    if (failApi) {
      return route.fulfill({ status: 500, json: { error: { code: "internal", message: "Erro interno" } } });
    }
    const parsed = parseJobsQuery(new URL(route.request().url()).searchParams);
    if (!parsed.ok) return route.fulfill({ status: 400, json: { error: parsed.error } });
    const result = await listJobs(db, parsed.value, !parsed.value.cursor);
    return route.fulfill({ json: { ...result, lastCollectedAt } });
  });
});

test.afterEach(() => {
  expect(problems, "sem violações de CSP nem erros de página").toEqual([]);
});

const cards = (page: Page) => page.locator("article");
const titles = (page: Page) => cards(page).getByRole("heading", { level: 3 }).allTextContents();

async function open(page: Page, path = "/") {
  await page.goto(path);
  await expect(cards(page).first()).toBeVisible();
}

test("lista em ordem decrescente de data, sem aviso de coleta atrasada", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("heading", { level: 1, name: "Vagas de tecnologia" })).toBeVisible();
  await expect(cards(page)).toHaveCount(30);
  const list = await titles(page);
  expect(list).toEqual(Array.from({ length: 30 }, (_, i) => `Vaga ${String(i).padStart(2, "0")} Desenvolvedor`));
  await expect(page.getByRole("status").filter({ hasText: "coleta" })).toHaveCount(0);
});

test("chip de stack grava stacks=react na URL e todos os cards mostram React", async ({ page }) => {
  await open(page);
  const chip = page.getByRole("button", { name: "React", exact: true });
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/[?&]stacks=react(&|$)/);
  await expect(cards(page)).toHaveCount(20);
  for (const card of await cards(page).all()) {
    await expect(card.getByText("React", { exact: true })).toBeVisible();
  }
});

test("filtro de origem Nacional", async ({ page }) => {
  await open(page);
  await page.getByRole("radio", { name: "Nacional", exact: true }).check();
  await expect(page).toHaveURL(/origin=national/);
  await expect(cards(page)).toHaveCount(14);
  for (const card of await cards(page).all()) await expect(card).toContainText("São Paulo");
});

test("abas mostram contadores, filtram por modelo de trabalho e mantêm a ordem", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("tab", { name: /^Todas\s*40$/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /^Remoto\s*20$/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Híbrido\s*10$/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Presencial\s*10$/ })).toBeVisible();

  await page.getByRole("tab", { name: /^Remoto/ }).click();
  await expect(page).toHaveURL(/workMode=remote/);
  await expect(page.getByRole("tab", { name: /^Remoto/ })).toHaveAttribute("aria-selected", "true");
  await expect(cards(page)).toHaveCount(20);
  const numbers = (await titles(page)).map((t) => Number(t.slice(5, 7)));
  expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
  for (const card of await cards(page).all()) await expect(card.getByText("Remoto", { exact: true })).toBeVisible();
});

test("estado vazio oferece Limpar filtros, que zera a URL", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Angular", exact: true }).click();
  await expect(page.getByText("Nenhuma vaga encontrada")).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expect(page).toHaveURL(/stacks=angular/);

  await page.getByRole("button", { name: "Limpar filtros" }).click();
  await expect(cards(page)).toHaveCount(30);
  await expect(page).toHaveURL((url) => url.search === "");
});

test("Carregar mais traz a página 2 sem repetir vagas", async ({ page }) => {
  await open(page);
  await expect(cards(page)).toHaveCount(30);
  await page.getByRole("button", { name: "Carregar mais vagas" }).click();
  await expect(cards(page)).toHaveCount(40);
  const list = await titles(page);
  expect(new Set(list).size).toBe(40);
  expect(list[30]).toBe("Vaga 30 Desenvolvedor");
  await expect(page.getByRole("button", { name: "Carregar mais vagas" })).toHaveCount(0);
});

test("coleta atrasada mostra o aviso com o horário em America/Sao_Paulo", async ({ page }) => {
  const stale = new Date(Date.now() - 4 * HOUR);
  lastCollectedAt = stale.toISOString();
  await open(page);
  const time = stale.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
  const banner = page.getByRole("status").filter({ hasText: "coleta" });
  await expect(banner).toContainText("coleta");
  await expect(banner).toContainText(time);
  await expect(page.getByRole("link", { name: "por quê?" })).toHaveAttribute("href", "/fontes");
});

test("RF-01: o primeiro card começa acima de y=600 no desktop 1440x900", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const box = await cards(page).first().boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeLessThan(600);
});

test("erro da API mostra mensagem e permite tentar de novo", async ({ page }) => {
  failApi = true;
  await page.goto("/");
  await expect(page.locator("main").getByRole("alert")).toContainText("Não foi possível carregar as vagas");
  failApi = false;
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(cards(page).first()).toBeVisible();
});

test("busca por texto grava q na URL", async ({ page }) => {
  await open(page);
  await page.getByRole("searchbox", { name: "Buscar vagas" }).fill("Empresa 07");
  await page.getByRole("button", { name: "Buscar", exact: true }).click();
  await expect(page).toHaveURL(/q=Empresa\+07|q=Empresa%2007/);
  await expect(cards(page)).toHaveCount(1);
});
