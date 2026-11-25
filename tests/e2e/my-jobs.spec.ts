import { expect, test, type Page } from "@playwright/test";
import { getJob, listJobs } from "@/lib/server/jobs/query";
import { attributionFor } from "@/lib/server/sources/registry";
import { parseJobsQuery } from "@/lib/shared/schemas/jobs-query";
import { seedDatabase, type E2eDb } from "./seed";

// US-07: favoritar, ocultar e acompanhar o status das vagas; tela "Minhas vagas" (rota local, com CSP de nonce).

let db: E2eDb;
let closeDb: () => Promise<void>;
let problems: string[];
/** Ids que a API passa a tratar como fora do índice (404 no detalhe e ausentes da listagem). */
let gone: Set<number>;

const STATE_KEY = "jobfind:v1:jobState";

test.beforeAll(async () => {
  ({ db, close: closeDb } = await seedDatabase());
});

test.afterAll(async () => {
  await closeDb();
});

test.beforeEach(async ({ page }) => {
  problems = [];
  gone = new Set();
  page.on("console", (msg) => {
    if (/content security policy|refused to (load|apply|execute|connect)/i.test(msg.text())) problems.push(msg.text());
  });
  page.on("pageerror", (err) => problems.push(err.message));
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });

  // Os handlers reais rodam aqui sobre o banco semeado (o driver neon-http não fala com o Postgres local).
  await page.route("**/api/jobs*", async (route) => {
    const parsed = parseJobsQuery(new URL(route.request().url()).searchParams);
    if (!parsed.ok) return route.fulfill({ status: 400, json: { error: parsed.error } });
    const result = await listJobs(db, parsed.value, !parsed.value.cursor);
    const items = result.items.filter((j) => !gone.has(j.id));
    return route.fulfill({ json: { ...result, items, lastCollectedAt: new Date().toISOString() } });
  });
  await page.route("**/api/jobs/*", async (route) => {
    const raw = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
    const job = Number.isSafeInteger(id) && id > 0 && !gone.has(id) ? await getJob(db, id, attributionFor) : null;
    if (!job) return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Vaga não encontrada." } } });
    return route.fulfill({ json: job });
  });
});

test.afterEach(async ({ page }) => {
  const violations = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
  expect(violations, "sem violações de CSP").toEqual([]);
  expect(problems, "sem violações de CSP nem erros de página").toEqual([]);
});

const TITLE = (i: number) => `Vaga ${String(i).padStart(2, "0")} Desenvolvedor`;
const cards = (page: Page) => page.locator("article");
const card = (page: Page, i: number) => cards(page).filter({ hasText: TITLE(i) });

async function openHome(page: Page, path = "/") {
  await page.goto(path);
  await expect(cards(page).first()).toBeVisible();
}

/** Abre o menu "⋯" do card e escolhe um item (o status fica num submenu). */
async function menuAction(page: Page, title: string, item: string, status?: string) {
  await page.getByRole("button", { name: `Mais ações: ${title}` }).click();
  if (status) {
    await page.getByRole("menuitem", { name: "Mudar status" }).click();
    await page.getByRole("menuitemradio", { name: status, exact: true }).click();
  } else {
    await page.getByRole("menuitem", { name: item }).click();
  }
  // O próximo menu só abre depois que este fecha por completo.
  await expect(page.getByRole("menu")).toHaveCount(0);
}

const column = (page: Page, name: string) => page.getByRole("region", { name });

/** Botão "Mover" do card em Minhas vagas: escolhe o novo status. */
async function moveTo(page: Page, title: string, status: string) {
  await page.getByRole("button", { name: `Mover ${title}` }).click();
  await page.getByRole("menuitemradio", { name: status, exact: true }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
}

const todayBr = () => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date());

test("avisa quando o navegador não deixa gravar o favorito, o status ou ocultar", async ({ page }) => {
  await openHome(page);
  // Cota cheia: só as gravações do estado das vagas falham.
  await page.evaluate((key) => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === key) throw new DOMException("cota", "QuotaExceededError");
      return set.call(this, k, v);
    };
  }, STATE_KEY);
  const first = cards(page).first();
  await first.getByRole("button", { name: /^Favoritar/ }).click();
  await expect(first.getByRole("alert").filter({ hasText: "Não foi possível salvar neste navegador." })).toBeVisible();
  const firstTitle = (await first.getByRole("heading", { level: 3 }).textContent()) ?? "";
  await menuAction(page, firstTitle, "", "Salva");
  await expect(first.getByRole("alert")).toHaveCount(2);
  await menuAction(page, firstTitle, "Ocultar vaga");
  // Status e ocultar compartilham o mesmo aviso do menu: continuam 2 avisos (estrela + menu).
  await expect(first.getByRole("alert")).toHaveCount(2);
  // Sem gravação, a vaga continua na lista e não ganha o "Desfazer".
  await expect(first).toBeVisible();
  await expect(page.getByRole("button", { name: "Desfazer" })).toHaveCount(0);
});

test("favoritar na home e ver a vaga em Minhas vagas", async ({ page }) => {
  await openHome(page);
  const star = page.getByRole("button", { name: `Favoritar ${TITLE(0)}` });
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");

  await page.goto("/minhas-vagas");
  await expect(page.getByRole("heading", { level: 1, name: "Minhas vagas" })).toBeVisible();
  // Favorita sem status entra na etapa Salvas do funil.
  await expect(column(page, "Salvas").locator("article")).toHaveCount(1);
  await expect(card(page, 0)).toBeVisible();
  await expect(column(page, "Aplicadas").locator("article")).toHaveCount(0);

  // Desfavoritar na própria tela tira a vaga do funil.
  await page.getByRole("button", { name: `Favoritar ${TITLE(0)}` }).click();
  await expect(page.getByText(/Nenhuma vaga salva\./)).toBeVisible();
});

test("mudar o status para Aplicada registra a data e mostra o selo na listagem", async ({ page }) => {
  await openHome(page);
  await menuAction(page, TITLE(1), "", "Aplicada");
  const badge = card(page, 1).getByTestId("status-badge");
  await expect(badge).toHaveText(`Aplicada em ${todayBr()}`);

  const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!), STATE_KEY);
  const entry = Object.values(stored.data as Record<string, { status: string; statusHistory: { status: string; at: string }[] }>)[0];
  expect(entry.status).toBe("applied");
  expect(entry.statusHistory.map((h) => h.status)).toEqual(["applied"]);

  // Sobrevive ao recarregamento e aparece na aba Aplicadas.
  await page.reload();
  await expect(card(page, 1).getByTestId("status-badge")).toHaveText(`Aplicada em ${todayBr()}`);
  await page.goto("/minhas-vagas");
  await expect(column(page, "Aplicadas").locator("article")).toHaveCount(1);
  await expect(column(page, "Aplicadas").getByText(`Aplicada em ${todayBr()}`)).toBeVisible();

  // Mover para Entrevista troca de coluna; voltar para "Sem status" tira a vaga do funil.
  await moveTo(page, TITLE(1), "Entrevista");
  await expect(column(page, "Entrevista").locator("article")).toHaveCount(1);
  await expect(column(page, "Aplicadas").locator("article")).toHaveCount(0);
  await moveTo(page, TITLE(1), "Sem status");
  await expect(page.locator("article")).toHaveCount(0);
});

test("ocultar tira a vaga da home (com Desfazer) e Mostrar vagas ocultas a traz de volta", async ({ page }) => {
  await openHome(page);
  await menuAction(page, TITLE(2), "Ocultar vaga");
  await expect(card(page, 2)).toHaveCount(0);
  await expect(page.getByTestId("undo-region").getByText("Vaga oculta")).toBeVisible();

  // Desfazer devolve a vaga na hora.
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(card(page, 2)).toBeVisible();

  // Oculta de novo, recarrega: continua fora da lista.
  await menuAction(page, TITLE(2), "Ocultar vaga");
  await page.reload();
  await expect(cards(page).first()).toBeVisible();
  await expect(card(page, 2)).toHaveCount(0);

  await page.getByLabel("Mostrar vagas ocultas").check();
  await expect(page).toHaveURL(/ocultas=1/);
  await expect(card(page, 2)).toBeVisible();
  await expect(card(page, 2).getByText("Oculta", { exact: true })).toBeVisible();

  // Em Minhas vagas, a aba Ocultas oferece "Mostrar de novo".
  await page.goto("/minhas-vagas");
  await page.getByRole("button", { name: "Ocultas (1)" }).click();
  await page.getByRole("button", { name: `Mostrar de novo ${TITLE(2)}` }).click();
  await expect(page.getByText("Você não ocultou nenhuma vaga.")).toBeVisible();
  await openHome(page);
  await expect(card(page, 2)).toBeVisible();
});

test("vaga favorita que saiu do índice continua em Minhas vagas, e o gerador explica", async ({ page }) => {
  await openHome(page);
  await page.getByRole("button", { name: `Favoritar ${TITLE(3)}` }).click();
  // Sem abrir o detalhe: a listagem já traz a URL da fonte para o snapshot.
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), STATE_KEY))
    .toContain("https://boards.example.com/e2e/03");

  gone.add(4);

  await page.goto("/minhas-vagas");
  await expect(card(page, 3)).toBeVisible();
  await expect(card(page, 3)).toContainText("Empresa 03");
  await expect(card(page, 3).getByRole("link", { name: /Ver na fonte/ })).toHaveAttribute(
    "href",
    "https://boards.example.com/e2e/03",
  );

  await page.goto("/gerador/4");
  await expect(page.getByText("Esta vaga saiu do índice. Sem a descrição não dá para gerar o CV.")).toBeVisible();
  const source = page.getByRole("link", { name: /Ver a vaga na fonte/ });
  await expect(source).toHaveAttribute("href", "https://boards.example.com/e2e/03");
  await expect(source).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "Voltar para Minhas vagas" })).toBeVisible();

  // Sem estado guardado, a mensagem continua a genérica.
  await page.goto("/gerador/5");
  await expect(page.getByText(`${TITLE(4)} · Empresa 04`)).toBeVisible();
  gone.add(5);
  await page.goto("/gerador/5");
  await expect(page.getByRole("heading", { name: "Vaga não encontrada" })).toBeVisible();
});

test("do cabeçalho público para Minhas vagas sem violar a CSP, e as abas funcionam com o teclado", async ({ page }) => {
  await openHome(page);
  await page.getByRole("button", { name: `Favoritar ${TITLE(0)}` }).click();
  await page
    .getByRole("navigation", { name: "Principal" })
    .getByRole("link", { name: "Minhas vagas" })
    .click();
  await expect(page).toHaveURL(/\/minhas-vagas$/);
  await expect(page.getByRole("heading", { level: 1, name: "Minhas vagas" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Minhas vagas" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // No celular o funil vira um seletor segmentado.
  await page.setViewportSize({ width: 390, height: 844 });
  // Hidratou sob a CSP de nonce: a navegação por setas troca a aba selecionada.
  // O título vem do HTML do servidor e aparece antes da hidratação; uma seta antes dela se perde (CI lento).
  // Repete foco + seta até o React responder, em vez de supor que já hidratou.
  const first = page.getByRole("tab", { name: /Salvas/ });
  await expect(async () => {
    await first.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: /Aplicadas/ })).toHaveAttribute("aria-selected", "true", { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: /Proposta/ })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(card(page, 0)).toBeVisible();

  // Do detalhe público também (de volta ao desktop, onde há o cabeçalho completo).
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/vagas/1");
  await expect(page.getByRole("heading", { level: 1, name: TITLE(0) })).toBeVisible();
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Minhas vagas" }).click();
  await expect(page).toHaveURL(/\/minhas-vagas$/);
  await expect(card(page, 0)).toBeVisible();
});
