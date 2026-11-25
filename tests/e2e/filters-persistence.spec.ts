import { expect, test, type Page } from "@playwright/test";
import { listJobs } from "@/lib/server/jobs/query";
import { parseJobsQuery } from "@/lib/shared/schemas/jobs-query";
import { MINUTE, seedDatabase, type E2eDb } from "./seed";

const START = "/?workMode=remote&seniority=senior&stacks=react";
const FILTERS_URL = /^(?=.*workMode=remote)(?=.*seniority=senior)(?=.*stacks=react)/;

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
    const text = msg.text();
    if (/content security policy|refused to (load|apply|execute|connect)/i.test(text)) problems.push(text);
  });
  page.on("pageerror", (err) => problems.push(err.message));

  // Mesmo atalho de home.spec.ts: o handler real de `/api/jobs` roda aqui sobre o banco semeado.
  await page.route("**/api/jobs*", async (route) => {
    const parsed = parseJobsQuery(new URL(route.request().url()).searchParams);
    if (!parsed.ok) return route.fulfill({ status: 400, json: { error: parsed.error } });
    const result = await listJobs(db, parsed.value, !parsed.value.cursor);
    return route.fulfill({ json: { ...result, lastCollectedAt: new Date(Date.now() - 10 * MINUTE).toISOString() } });
  });
  // Detalhe da vaga: `/api/jobs/:id` usa o driver neon-http; aqui o `getJob` real roda sobre o banco semeado.
  await page.route("**/api/jobs/*", async (route) => {
    const { getJob } = await import("@/lib/server/jobs/query");
    const { attributionFor } = await import("@/lib/server/sources/registry");
    const raw = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const job = /^\d+$/.test(raw) ? await getJob(db, Number(raw), attributionFor) : null;
    if (!job) return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Vaga não encontrada." } } });
    return route.fulfill({ json: job });
  });
});

test.afterEach(() => {
  expect(problems, "sem violações de CSP nem erros de página").toEqual([]);
});

const cards = (page: Page) => page.locator("article");
const firstTitle = (page: Page) => cards(page).first().getByRole("heading", { level: 3 }).innerText();

async function openList(page: Page, path: string) {
  await page.goto(path);
  await expect(cards(page).first()).toBeVisible();
}

const restoredNotice = (page: Page) => page.getByRole("status").filter({ hasText: "Busca da última visita restaurada" });

/**
 * Ao voltar, a lista reaparece com os mesmos filtros na URL. Sem o aviso de restauração: a última busca também
 * está no localStorage e repõe os filtros se o "Voltar" cair em `/`; o aviso ausente prova que a URL veio do link.
 */
async function expectBackOnList(page: Page) {
  await expect(page).toHaveURL(FILTERS_URL);
  await expect(cards(page).first()).toBeVisible();
  await expect(restoredNotice(page)).toHaveCount(0);
}

test("abrir uma vaga e clicar em 'Voltar para as vagas' mantém filtros e o primeiro card", async ({ page }) => {
  await openList(page, START);
  const before = await firstTitle(page);
  await cards(page).first().getByRole("link").first().click();
  await expect(page).toHaveURL(/\/vagas\/\d+/);
  await page.getByRole("link", { name: /Voltar para as vagas/ }).filter({ visible: true }).click();
  await expectBackOnList(page);
  expect(await firstTitle(page)).toBe(before);
});

test("vaga reaberta por Minhas vagas: 'Voltar para as vagas' vai à lista com filtros, não a Minhas vagas", async ({
  page,
}) => {
  await openList(page, START);
  const title = await firstTitle(page);
  await page.getByRole("button", { name: `Favoritar ${title}` }).click();
  await cards(page).first().getByRole("link").first().click();
  await expect(page).toHaveURL(/\/vagas\/\d+/);
  const jobUrl = page.url();

  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: /Minhas vagas/ }).click();
  await expect(page).toHaveURL(/\/minhas-vagas/);
  await page.locator("article").getByRole("link", { name: title, exact: true }).click();
  await expect(page).toHaveURL(jobUrl);

  await page.getByRole("link", { name: /Voltar para as vagas/ }).filter({ visible: true }).click();
  await expectBackOnList(page);
  await expect(page).not.toHaveURL(/\/minhas-vagas/);
});

test("'Carregar mais' e voltar de uma vaga da 2ª página mantém o número de cards", async ({ page }) => {
  // Filtro que não reduz a lista abaixo de uma página (40 vagas semeadas, 30 por página).
  await openList(page, "/?since=30d");
  await expect(cards(page)).toHaveCount(30);
  await page.getByRole("button", { name: "Carregar mais vagas" }).click();
  await expect(cards(page)).toHaveCount(40);
  await cards(page).nth(35).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/vagas\/\d+/);
  await page.getByRole("link", { name: /Voltar para as vagas/ }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/since=30d/);
  await expect(cards(page)).toHaveCount(40);
  await expect(restoredNotice(page)).toHaveCount(0);
});

test("de /perfil, o link 'Vagas' do header volta à lista com os filtros", async ({ page }) => {
  await openList(page, START);
  await page.goto("/perfil");
  const link = page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Vagas", exact: true });
  await expect(link).toHaveAttribute("href", /workMode=remote/);
  await link.click();
  await expectBackOnList(page);
});

test("de /fontes, o logo volta à lista com os filtros", async ({ page }) => {
  await openList(page, START);
  await page.goto("/fontes");
  const logo = page.getByRole("banner").getByRole("link", { name: /Job\s*Find/ });
  await expect(logo).toHaveAttribute("href", /workMode=remote/);
  await logo.click();
  await expectBackOnList(page);
});

test.describe("celular", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("seta de voltar e aba 'Vagas' preservam os filtros", async ({ page }) => {
    await openList(page, START);
    await cards(page).first().getByRole("link").first().click();
    await expect(page).toHaveURL(/\/vagas\/\d+/);
    await page.getByRole("link", { name: "Voltar para as vagas" }).click();
    await expectBackOnList(page);

    const tabs = page.getByRole("navigation", { name: "Navegação inferior" });
    await tabs.getByRole("link", { name: /Minhas vagas/ }).click();
    await expect(page).toHaveURL(/\/minhas-vagas/);
    const vagas = tabs.getByRole("link", { name: "Vagas", exact: true });
    await expect(vagas).toHaveAttribute("href", /workMode=remote/);
    await vagas.click();
    await expectBackOnList(page);
  });
});

const savedFilters = { workMode: "remote", seniority: ["senior"], stacks: ["react"] };

async function seedLastFilters(page: Page, filters: Record<string, unknown>) {
  await page.addInitScript(
    ({ key, value }) => {
      // Só grava na primeira carga do contexto: recarregar não pode recriar a busca já limpa.
      if (!window.sessionStorage.getItem("e2e:seeded")) {
        window.sessionStorage.setItem("e2e:seeded", "1");
        window.localStorage.setItem(key, value);
      }
    },
    {
      key: "jobfind:v1:lastFilters",
      value: JSON.stringify({ v: 1, data: { filters, savedAt: new Date().toISOString() } }),
    },
  );
}

test("última busca é restaurada com aviso; Limpar remove os filtros e recarregar não restaura", async ({ page }) => {
  await seedLastFilters(page, savedFilters);
  await page.goto("/");
  await expect(page).toHaveURL(FILTERS_URL);
  const notice = page.getByRole("status").filter({ hasText: "Busca da última visita restaurada" });
  await expect(notice).toBeVisible();

  await notice.getByRole("button", { name: "Limpar", exact: true }).click();
  await expect(page).toHaveURL((url) => url.search === "");
  await expect(notice).toHaveCount(0);

  await page.reload();
  await expect(cards(page).first()).toBeVisible();
  await expect(page).toHaveURL((url) => url.search === "");
  await expect(notice).toHaveCount(0);
});

test("o aviso de busca restaurada some quando um filtro muda", async ({ page }) => {
  await seedLastFilters(page, savedFilters);
  await page.goto("/");
  const notice = page.getByRole("status").filter({ hasText: "Busca da última visita restaurada" });
  await expect(notice).toBeVisible();
  await page.getByRole("radio", { name: "Nacional", exact: true }).check();
  await expect(page).toHaveURL(/origin=national/);
  await expect(notice).toHaveCount(0);
});

test("URL compartilhada com filtros vence a última busca", async ({ page }) => {
  await seedLastFilters(page, { lang: "pt" });
  await page.goto("/?lang=en");
  await expect(cards(page).first()).toBeVisible();
  await expect(page).toHaveURL(/lang=en/);
  await expect(page).not.toHaveURL(/lang=pt/);
  await expect(page.getByRole("status").filter({ hasText: "Busca da última visita restaurada" })).toHaveCount(0);
});
