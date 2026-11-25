import { expect, test, type Page } from "@playwright/test";
import { getJob, listJobs } from "@/lib/server/jobs/query";
import { attributionFor } from "@/lib/server/sources/registry";
import { parseJobsQuery } from "@/lib/shared/schemas/jobs-query";
import { MINUTE, seedDatabase, type E2eDb } from "./seed";

// US-05: score local de chance. Vagas pares (react + typescript, sênior, em inglês ou português,
// aceitam Brasil) casam 100% com o perfil semeado; as ímpares (vue, pleno) ficam em 45% (média).

const PROFILE_KEY = "jobfind:v1:profile";

const PROFILE = {
  v: 1,
  data: {
    schemaVersion: 1,
    name: "Ana Exemplo",
    headline: null,
    location: "São Paulo, BR",
    seniority: "senior",
    englishLevel: "advanced",
    summary: null,
    contact: { email: null, phone: null, links: [] },
    skills: [
      { name: "React", years: 5, stackId: "react" },
      { name: "TypeScript", years: 6, stackId: "typescript" },
    ],
    experiences: [],
    education: [],
  },
};

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

  // O handler real roda aqui sobre o banco semeado (o driver neon-http não fala com o Postgres local).
  await page.route("**/api/jobs*", async (route) => {
    const parsed = parseJobsQuery(new URL(route.request().url()).searchParams);
    if (!parsed.ok) return route.fulfill({ status: 400, json: { error: parsed.error } });
    const result = await listJobs(db, parsed.value, !parsed.value.cursor);
    return route.fulfill({ json: { ...result, lastCollectedAt: new Date(Date.now() - 10 * MINUTE).toISOString() } });
  });
  await page.route("**/api/jobs/*", async (route) => {
    const raw = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const job = /^\d+$/.test(raw) ? await getJob(db, Number(raw), attributionFor) : null;
    if (!job) return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Vaga não encontrada." } } });
    return route.fulfill({ json: job });
  });
});

test.afterEach(() => {
  expect(problems, "sem violações de CSP nem erros de página").toEqual([]);
});

async function seedProfile(page: Page) {
  await page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [PROFILE_KEY, JSON.stringify(PROFILE)]);
}

const cards = (page: Page) => page.locator("article");
const titles = (page: Page) => cards(page).getByRole("heading", { level: 3 }).allTextContents();

test("com perfil salvo, cada vaga da lista mostra a faixa e o percentual", async ({ page }) => {
  await seedProfile(page);
  await page.goto("/");
  await expect(cards(page)).toHaveCount(30);
  for (const card of await cards(page).all()) {
    await expect(card.getByText(/^(Alta|Média|Baixa) · \d+%$/)).toBeVisible();
  }
  // Vaga 00 (react + typescript) = 100%; vaga 01 (vue, pleno) = 45%.
  await expect(cards(page).nth(0).getByText("Alta · 100%")).toBeVisible();
  await expect(cards(page).nth(1).getByText("Média · 45%")).toBeVisible();
  await expect(page.getByText("Importe seu currículo para ver")).toHaveCount(0);
});

test("sem perfil, a lista tem um único convite (banner) e nenhum rádio de chance", async ({ page }) => {
  await page.goto("/");
  await expect(cards(page)).toHaveCount(30);
  await expect(page.getByText("Importe seu currículo para ver")).toHaveCount(0);
  const banner = page.getByRole("region", { name: "Progresso da configuração" });
  await expect(banner).toHaveCount(1);
  await expect(banner.getByRole("link", { name: "Conectar IA" })).toHaveAttribute("href", "/configuracoes");
  await expect(page.getByRole("radio", { name: "Chance: Alta" })).toHaveCount(0);
  await expect(page.getByText("Filtro de chance disponível depois de importar o currículo.")).toBeVisible();
});

test("filtro 'Chance: Alta' mostra só vagas com score >= 70, da mais nova para a mais antiga", async ({ page }) => {
  await seedProfile(page);
  await page.goto("/");
  await expect(cards(page)).toHaveCount(30);

  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/jobs")) requests.push(r.url());
  });
  await page.getByRole("radio", { name: "Chance: Alta" }).check();
  await expect(page).toHaveURL(/[?&]chance=alta(&|$)/);
  // 20 vagas pares casam; as 20 ímpares (45%) saem. Tudo cabe numa requisição de 90.
  await expect(cards(page)).toHaveCount(20);
  for (const card of await cards(page).all()) {
    const text = (await card.getByText(/^Alta · \d+%$/).textContent()) ?? "";
    expect(Number(/(\d+)%/.exec(text)![1])).toBeGreaterThanOrEqual(70);
  }
  const numbers = (await titles(page)).map((t) => Number(t.slice(5, 7)));
  expect(numbers).toEqual(Array.from({ length: 20 }, (_, i) => i * 2));
  // O filtro é só do cliente: a API só vê `limit=90`, nunca `chance`.
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every((u) => !u.includes("chance"))).toBe(true);
  expect(requests.some((u) => u.includes("limit=90"))).toBe(true);

  // Recarregar com a URL mantém o filtro.
  await page.reload();
  await expect(cards(page)).toHaveCount(20);
  await expect(page.getByRole("radio", { name: "Chance: Alta" })).toBeChecked();
});

test("o detalhe da vaga mostra 'Sua chance' com o breakdown", async ({ page }) => {
  await seedProfile(page);
  await page.goto("/");
  await cards(page).nth(1).getByRole("link", { name: "Vaga 01 Desenvolvedor" }).click();
  const section = page.getByRole("region", { name: "Sua chance" });
  await expect(section.getByText("Média · 45%")).toBeVisible();
  const items = section.getByRole("list", { name: "Detalhes da nota" }).getByRole("listitem");
  await expect(items).toHaveCount(5);
  for (const label of ["Tecnologias", "Senioridade", "Idioma", "Local", "Recência"]) {
    await expect(section.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(section.getByText("Faltam no seu perfil: Vue.")).toBeVisible();
});

test("o detalhe sem perfil convida a importar o currículo", async ({ page }) => {
  await page.goto("/vagas/1");
  const section = page.getByRole("region", { name: "Sua chance" });
  await expect(section.getByRole("link", { name: "Importe seu currículo para ver" })).toHaveAttribute("href", "/perfil");
  await expect(section.getByRole("list")).toHaveCount(0);
});
