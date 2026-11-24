import { expect, test, type Page } from "@playwright/test";
import { eq } from "drizzle-orm";
import { jobs } from "@/lib/server/db/schema";
import { listJobs } from "@/lib/server/jobs/query";
import { parseJobsQuery } from "@/lib/shared/schemas/jobs-query";
import { MINUTE, seedDatabase, type E2eDb } from "./seed";

// RF-22 (busca padrão e selo "Nova") e RF-23 (salário). As vagas semeadas: a vaga `i` foi publicada há (i + 1) * 30 min;
// pares são react + typescript, ímpares vue; `workMode` segue remote, remote, hybrid, onsite.

const SAVED_KEY = "jobfind:v1:savedFilters";
const VISIT_KEY = "jobfind:v1:lastVisit";

let db: E2eDb;
let closeDb: () => Promise<void>;
let problems: string[];

test.beforeAll(async () => {
  ({ db, close: closeDb } = await seedDatabase());
  const salary = (title: string, values: Partial<typeof jobs.$inferInsert>) =>
    db.update(jobs).set(values).where(eq(jobs.title, title));
  await salary("Vaga 00 Desenvolvedor", { salaryMin: "14000", salaryMax: "18000", salaryCurrency: "BRL", salaryPeriod: "month" });
  await salary("Vaga 01 Desenvolvedor", { salaryMin: "120000", salaryCurrency: "USD", salaryPeriod: "year" });
  await salary("Vaga 02 Desenvolvedor", { salaryMax: "80", salaryCurrency: "EUR", salaryPeriod: "hour" });
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
  await page.route("**/api/jobs*", async (route) => {
    const parsed = parseJobsQuery(new URL(route.request().url()).searchParams);
    if (!parsed.ok) return route.fulfill({ status: 400, json: { error: parsed.error } });
    const result = await listJobs(db, parsed.value, !parsed.value.cursor);
    return route.fulfill({ json: { ...result, lastCollectedAt: new Date(Date.now() - 10 * MINUTE).toISOString() } });
  });
});

test.afterEach(() => {
  expect(problems, "sem violações de CSP nem erros de página").toEqual([]);
});

const cards = (page: Page) => page.locator("article");
const card = (page: Page, n: number) => cards(page).filter({ hasText: `Vaga ${String(n).padStart(2, "0")} Desenvolvedor` });

async function open(page: Page, path = "/") {
  await page.goto(path);
  await expect(cards(page).first()).toBeVisible();
}

/** Grava `lastVisit` só na primeira carga da aba: recarregar ou navegar não desfaz o que a página gravou ao sair. */
async function seedLastVisit(page: Page, iso: string) {
  await page.addInitScript(
    ([key, value]) => {
      if (sessionStorage.getItem("e2e-seeded")) return;
      sessionStorage.setItem("e2e-seeded", "1");
      localStorage.setItem(key, JSON.stringify({ v: 1, data: value }));
    },
    [VISIT_KEY, iso],
  );
}

const stored = (page: Page, key: string) =>
  page.evaluate((k) => {
    const raw = localStorage.getItem(k);
    return raw === null ? null : (JSON.parse(raw) as { v: number; data: unknown }).data;
  }, key);

test.describe("busca padrão", () => {
  test("salva os filtros e os aplica ao abrir a home sem parâmetros", async ({ page }) => {
    await open(page, "/?workMode=remote&stacks=react&ocultas=1");
    const filters = page.getByRole("complementary", { name: "Filtros" });
    await expect(filters.getByText("Busca padrão ativa")).toHaveCount(0);
    await filters.getByRole("button", { name: "Salvar como busca padrão" }).click();
    await expect(filters.getByText("Busca padrão ativa")).toBeVisible();
    // Sem página, cursor nem `ocultas`.
    expect(await stored(page, SAVED_KEY)).toEqual({ workMode: "remote", stacks: ["react"] });

    await page.goto("/privacidade");
    await page.goto("/");
    await expect(page).toHaveURL(/[?&]workMode=remote(&|$)/);
    await expect(page).toHaveURL(/[?&]stacks=react(&|$)/);
    await expect(page).not.toHaveURL(/ocultas/);
    await expect(cards(page).first()).toBeVisible();
    for (const c of await cards(page).all()) {
      await expect(c.getByText("Remoto", { exact: true })).toBeVisible();
      await expect(c.getByText("React", { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("complementary", { name: "Filtros" }).getByText("Busca padrão ativa")).toBeVisible();
  });

  test("qualquer filtro na URL impede a busca padrão", async ({ page }) => {
    await open(page, "/?workMode=remote");
    await page.getByRole("button", { name: "Salvar como busca padrão" }).click();
    await expect.poll(() => stored(page, SAVED_KEY)).toEqual({ workMode: "remote" });

    await open(page, "/?workMode=hybrid");
    await expect(page).toHaveURL(/[?&]workMode=hybrid(&|$)/);
    await expect(page).not.toHaveURL(/workMode=remote/);
    await expect(page.getByText("Remoto", { exact: true })).toHaveCount(0);
    expect(await stored(page, SAVED_KEY)).toEqual({ workMode: "remote" });
  });

  test("remover a busca padrão deixa a home sem filtros", async ({ page }) => {
    await open(page, "/?origin=national");
    await page.getByRole("button", { name: "Salvar como busca padrão" }).click();
    await expect.poll(() => stored(page, SAVED_KEY)).toEqual({ origin: "national" });
    await page.getByRole("button", { name: "Remover busca padrão" }).click();
    await expect(page.getByText("Busca padrão ativa")).toHaveCount(0);
    expect(await stored(page, SAVED_KEY)).toBeNull();

    await open(page, "/");
    await expect(page).not.toHaveURL(/origin=/);
    await expect(cards(page)).toHaveCount(30);
  });

  test("uma busca padrão inválida é ignorada", async ({ page }) => {
    await page.addInitScript(
      ([key]) => localStorage.setItem(key, JSON.stringify({ v: 1, data: { workMode: "inexistente" } })),
      [SAVED_KEY],
    );
    await open(page, "/");
    await expect(page).not.toHaveURL(/workMode/);
    await expect(page.getByText("Busca padrão ativa")).toHaveCount(0);
    await expect(cards(page)).toHaveCount(30);
  });

  test("sem filtros, não há o que salvar", async ({ page }) => {
    await open(page, "/");
    await expect(page.getByRole("button", { name: "Salvar como busca padrão" })).toBeDisabled();
  });
});

test.describe("selo Nova", () => {
  test("só vagas publicadas depois da visita anterior; a saída da página atualiza a visita", async ({ page }) => {
    // Visita há 100 min: só as vagas 00, 01 e 02 (30, 60 e 90 min atrás) são posteriores.
    const previous = new Date(Date.now() - 100 * MINUTE).toISOString();
    await seedLastVisit(page, previous);
    await open(page);
    await expect(page.getByText("Nova", { exact: true })).toHaveCount(3);
    for (const n of [0, 1, 2]) await expect(card(page, n).getByText("Nova", { exact: true })).toBeVisible();
    await expect(card(page, 3).getByText("Nova", { exact: true })).toHaveCount(0);

    // Navegar dentro da sessão não gravou nada: a visita continua a anterior.
    expect(await stored(page, VISIT_KEY)).toBe(previous);

    await page.goto("/privacidade");
    const visit = (await stored(page, VISIT_KEY)) as string;
    expect(Date.now() - new Date(visit).getTime()).toBeLessThan(60_000);
    expect(new Date(visit).getTime()).toBeGreaterThan(new Date(previous).getTime());

    // Na visita seguinte, as mesmas vagas já não são novas.
    await open(page, "/");
    await expect(page.getByText("Nova", { exact: true })).toHaveCount(0);
  });

  test("primeira visita não mostra selo nenhum", async ({ page }) => {
    await open(page);
    expect(await stored(page, VISIT_KEY)).toBeNull();
    await expect(page.getByText("Nova", { exact: true })).toHaveCount(0);
  });
});

test.describe("salário", () => {
  test("mostra o salário no formato pt-BR quando existe e nada quando não existe", async ({ page }) => {
    await open(page);
    await expect(card(page, 0).getByText("R$ 14.000 – 18.000 / mês", { exact: true })).toBeVisible();
    await expect(card(page, 1).getByText("a partir de US$ 120.000 / ano", { exact: true })).toBeVisible();
    await expect(card(page, 2).getByText("até € 80 / hora", { exact: true })).toBeVisible();
    // As demais vagas não têm salário: nada de "R$", "US$", "€" nem "/ mês" nos cards.
    for (const n of [3, 4, 5]) await expect(card(page, n).getByText(/R\$|US\$|€|\/ (mês|ano|hora)/)).toHaveCount(0);
    await expect(page.getByText(/\/ (mês|ano|hora)/)).toHaveCount(3);
  });
});
