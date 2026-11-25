import { expect, test } from "@playwright/test";
import { upsertJob } from "@/lib/server/jobs/upsert";
import { getJob } from "@/lib/server/jobs/query";
import { attributionFor } from "@/lib/server/sources/registry";
import { seedDatabase, seedJob, type E2eDb } from "./seed";

let db: E2eDb;
let closeDb: () => Promise<void>;
let problems: string[];
let dialogs: string[];

const XSS_SOURCE_URL = "https://boards.greenhouse.io/e2e/xss";
const XSS_HTML =
  '<p>Texto seguro da vaga XSS</p><img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">link ruim</a>';

/** Id da vaga XSS (a 41ª, inserida depois das 40 da home). */
let xssId: number;
let himalayasId: number;
const HIMALAYAS_APPLY_URL = "https://himalayas.app/companies/e2e/jobs/dev?utm_source=api";

test.beforeAll(async () => {
  ({ db, close: closeDb } = await seedDatabase());
  // `seedJob` grava a descrição como veio (sem passar pelo sanitizador do servidor), então o
  // payload chega ao navegador e quem o neutraliza é o `toSafeHtml` do cliente.
  const now = new Date();
  const xss = {
    ...seedJob(50, now),
    dedupeKey: "e2e-xss",
    urlCanonical: XSS_SOURCE_URL,
    title: "Vaga XSS Desenvolvedor",
    descriptionHtml: XSS_HTML,
    contentHash: "e2e-hash-xss",
  };
  const { jobId } = await upsertJob(db, xss, { source: "greenhouse", externalId: "e2e-xss", url: XSS_SOURCE_URL }, now);
  if (jobId === null) throw new Error("vaga XSS não gravada");
  xssId = jobId;
  // Vaga do Himalayas: a URL da fonte traz `?utm_source=api`, que o botão precisa manter (D-07).
  const him = {
    ...seedJob(51, now),
    dedupeKey: "e2e-himalayas",
    urlCanonical: "https://himalayas.app/companies/e2e/jobs/dev",
    title: "Vaga Himalayas Desenvolvedor",
    contentHash: "e2e-hash-himalayas",
  };
  const himRes = await upsertJob(db, him, { source: "himalayas", externalId: "e2e-him", url: HIMALAYAS_APPLY_URL }, now);
  if (himRes.jobId === null) throw new Error("vaga Himalayas não gravada");
  himalayasId = himRes.jobId;
});

test.afterAll(async () => {
  await closeDb();
});

test.beforeEach(async ({ page }) => {
  problems = [];
  dialogs = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (/content security policy|refused to (load|apply|execute|connect)/i.test(text)) problems.push(text);
  });
  page.on("pageerror", (err) => problems.push(err.message));
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  // `/api/jobs/:id` usa o driver neon-http, que não fala com o Postgres local: o `getJob` e o
  // `attributionFor` reais rodam aqui sobre o banco semeado. O padrão `*` não casa `/`, então
  // não colide com a interceptação de `/api/jobs` da home.
  await page.route("**/api/jobs/*", async (route) => {
    const raw = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
    const job = Number.isSafeInteger(id) && id > 0 ? await getJob(db, id, attributionFor) : null;
    if (!job) return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Vaga não encontrada." } } });
    return route.fulfill({ json: job });
  });
});

test.afterEach(() => {
  expect(problems, "sem violações de CSP nem erros de página").toEqual([]);
  expect(dialogs, "nenhum alert/confirm/prompt disparou").toEqual([]);
});

test("mostra título, empresa, chips, descrição e atribuição com links para a fonte", async ({ page }) => {
  await page.goto("/vagas/1");
  await expect(page.getByRole("heading", { level: 1, name: "Vaga 00 Desenvolvedor" })).toBeVisible();
  await expect(page.getByText("Empresa 00 · São Paulo, BR")).toBeVisible();
  for (const chip of ["Remoto", "Sênior", "Português", "React", "TypeScript"]) {
    await expect(page.getByText(chip, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("Descrição 00", { exact: true })).toBeVisible();

  const header = page.locator("section").first();
  await expect(header).toContainText("coletada de");
  const origin = header.getByRole("link", { name: "Greenhouse (abre em nova aba)", exact: true });
  await expect(origin).toHaveAttribute("href", "https://boards.example.com/e2e/00");
  await expect(origin).toHaveAttribute("target", "_blank");
  await expect(origin).toHaveAttribute("rel", /noopener/);

  const apply = page.getByRole("link", { name: /Candidatar-se na/ });
  await expect(apply).toHaveAttribute("href", "https://boards.example.com/e2e/00");
  await expect(apply).toHaveAttribute("target", "_blank");
  await expect(apply).toHaveAttribute("rel", /noopener/);
  await expect(apply).toHaveAttribute("rel", /noreferrer/);

  await expect(page.getByRole("heading", { level: 2, name: "Sua aderência" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Análise com IA" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Voltar para as vagas/ })).toHaveAttribute("href", "/");
});

test("o botão Candidatar mantém a URL da fonte intacta, com utm_source (Himalayas, D-07)", async ({ page }) => {
  await page.goto(`/vagas/${himalayasId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Vaga Himalayas Desenvolvedor" })).toBeVisible();
  const apply = page.getByRole("link", { name: /Candidatar-se na/ });
  await expect(apply).toHaveAttribute("href", HIMALAYAS_APPLY_URL);
  await expect(apply).toContainText("(abre em nova aba)");
});

test("descrição com payload XSS não executa script nem mantém atributos perigosos", async ({ page }) => {
  await page.goto(`/vagas/${xssId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Vaga XSS Desenvolvedor" })).toBeVisible();
  const description = page.getByText("Texto seguro da vaga XSS");
  await expect(description).toBeVisible();
  // Dá tempo de um onerror (imagem inexistente) disparar, se existisse.
  await page.waitForTimeout(500);

  const html = await page.locator("article").innerHTML();
  expect(html).not.toMatch(/onerror/i);
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/javascript:/i);
  await expect(page.locator("article img")).toHaveCount(0);

  const origin = page.locator("section").first().getByRole("link", { name: "Greenhouse (abre em nova aba)", exact: true });
  await expect(origin).toHaveAttribute("href", XSS_SOURCE_URL);
});

test("detalhe da vaga tem noindex e o robots.txt bloqueia a API", async ({ page, request }) => {
  await page.goto("/vagas/1");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBe(true);
  expect(await robots.text()).toMatch(/^Disallow: \/api\/$/m);
});

test("vaga inexistente mostra 'Vaga não encontrada' com link para a lista", async ({ page }) => {
  await page.goto("/vagas/999999");
  await expect(page.getByRole("heading", { name: "Vaga não encontrada" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Voltar para as vagas/ })).toHaveAttribute("href", "/");
});

test("id não numérico mostra 'Vaga não encontrada' sem chamar a API", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/jobs/*", async (route) => {
    calls++;
    await route.fallback();
  });
  await page.goto("/vagas/abc");
  await expect(page.getByRole("heading", { name: "Vaga não encontrada" })).toBeVisible();
  expect(calls).toBe(0);
});

test("sem perfil: Gerar CV desabilitado com o motivo e um único pedido de currículo", async ({ page }) => {
  await page.goto("/vagas/1");
  await expect(page.getByRole("button", { name: "Gerar CV + carta · precisa do currículo" })).toBeDisabled();
  const aderencia = page.getByRole("region", { name: "Sua aderência" });
  await expect(aderencia.getByRole("link", { name: "Conectar IA" })).toHaveAttribute("href", "/configuracoes?voltar=%2Fvagas%2F1");
  await expect(page.getByRole("link", { name: /Importar currículo/ })).toHaveCount(0);
});

test.describe("celular", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("barra de ação fixa, abas e CTA em uma linha", async ({ page }) => {
    await page.goto("/vagas/1");
    const bar = page.getByRole("group", { name: "Ações da vaga" });
    await expect(bar).toBeVisible();
    const cta = bar.getByRole("link", { name: /Candidatar-se na/ });
    await expect(cta).toBeVisible();
    const box = await cta.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(56);
    await expect(page.getByRole("navigation", { name: "Navegação inferior" })).toHaveCount(0);

    await expect(page.getByRole("heading", { level: 2, name: "Análise com IA" })).toBeHidden();
    await page.getByRole("tab", { name: "Análise com IA" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Análise com IA" })).toBeVisible();
    await expect(page.getByText("Descrição 00", { exact: true })).toBeHidden();
  });
});
