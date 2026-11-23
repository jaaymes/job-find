import { expect, test, type Page, type Route } from "@playwright/test";
import { getJob, listJobs } from "@/lib/server/jobs/query";
import { attributionFor } from "@/lib/server/sources/registry";
import { parseJobsQuery } from "@/lib/shared/schemas/jobs-query";
import { MINUTE, seedDatabase, type E2eDb } from "./seed";

// US-05: "Analisar com IA" no detalhe da vaga (RF-16). O provedor (DeepSeek) é mockado.

const AI_KEY = "jobfind:v1:ai";
const PROFILE_KEY = "jobfind:v1:profile";
const ANALYSIS_KEY = "jobfind:v1:aiAnalysis";
const CHAT_URL = "https://api.deepseek.com/v1/chat/completions";

// Dados fictícios que NUNCA podem chegar ao provedor.
const EMAIL = "ana.exemplo@exemplo.test";
const PHONE_DIGITS = "98888-7777";
const STREET = "Rua das Flores, 123";

const PROFILE = {
  v: 1,
  data: {
    schemaVersion: 1,
    name: "Ana Exemplo",
    headline: "Desenvolvedora Full Stack",
    location: "São Paulo, SP, Brasil",
    seniority: "senior",
    englishLevel: "advanced",
    summary: `Seis anos com React. Moro na ${STREET}.`,
    contact: { email: EMAIL, phone: `(11) ${PHONE_DIGITS}`, links: ["https://github.com/ana-exemplo"] },
    skills: [
      { name: "React", years: 5, stackId: "react" },
      { name: "TypeScript", years: 6, stackId: "typescript" },
    ],
    experiences: [
      {
        id: "exp_1",
        company: "Empresa Ficticia Ltda",
        title: "Desenvolvedora Sênior",
        startDate: "2020-01",
        endDate: null,
        bullets: [{ id: "exp_1.b1", text: `Reduziu o tempo de carregamento em 40% (contato ${EMAIL})` }],
      },
    ],
    education: [],
  },
};

const XSS = `<img src=x onerror="window.__xss=true">`;

const FIT = {
  strengths: ["6 anos com React em produto de grande escala.", XSS],
  gaps: ["GraphQL não aparece no seu currículo (importante)."],
  missingKeywords: ["GraphQL", "Core Web Vitals"],
  revisedScore: 140,
};

const cors = (route: Route): Record<string, string> => ({
  "access-control-allow-origin": "*",
  "access-control-allow-headers": route.request().headers()["access-control-request-headers"] ?? "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
});

function sse(content: string): string {
  const chunk = (delta: object, finish: string | null) =>
    `data: ${JSON.stringify({
      id: "c1",
      object: "chat.completion.chunk",
      created: 1,
      model: "m",
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  return (
    chunk({ role: "assistant", content: "" }, null) +
    chunk({ content }, null) +
    chunk({}, "stop") +
    `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n` +
    "data: [DONE]\n\n"
  );
}

type Mock = { bodies: string[]; statuses: number[] };

async function mockAi(page: Page): Promise<Mock> {
  const mock: Mock = { bodies: [], statuses: [] };
  await page.route(
    (url) => url.hostname !== "localhost",
    (route) => route.fulfill({ status: 503, headers: cors(route), body: "não mockado" }),
  );
  await page.route(CHAT_URL, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(route) });
    mock.bodies.push(route.request().postData() ?? "");
    const status = mock.statuses.shift() ?? 200;
    if (status !== 200) {
      return route.fulfill({ status, headers: cors(route), contentType: "application/json", body: JSON.stringify({ error: { message: "x" } }) });
    }
    return route.fulfill({ status: 200, headers: cors(route), contentType: "text/event-stream", body: sse(JSON.stringify(FIT)) });
  });
  return mock;
}

const AI_SETTINGS = {
  v: 1,
  data: {
    providers: { deepseek: { key: "sk-test-deepseek-1234", addedAt: "2026-11-20T00:00:00.000Z", source: "paste", privacyAccepted: true } },
    tasks: { extract: null, analyze: null, cv: null },
    dataCollectionDeny: true,
    minimizePii: true,
  },
};

async function seedStorage(page: Page, entries: Record<string, unknown>) {
  await page.addInitScript(
    (e) => {
      for (const [k, v] of Object.entries(e)) if (!window.localStorage.getItem(k)) window.localStorage.setItem(k, JSON.stringify(v));
    },
    entries,
  );
}

let db: E2eDb;
let closeDb: () => Promise<void>;
let problems: string[];
let mock: Mock;

test.beforeAll(async () => {
  ({ db, close: closeDb } = await seedDatabase());
});

test.afterAll(async () => {
  await closeDb();
});

test.beforeEach(async ({ page }) => {
  problems = [];
  page.on("console", (msg) => {
    if (/content security policy|refused to (load|apply|execute|connect|create)/i.test(msg.text())) problems.push(msg.text());
  });
  page.on("pageerror", (err) => problems.push(err.message));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`CSP ${e.violatedDirective} ${e.blockedURI}`);
    });
  });

  mock = await mockAi(page);
  await page.route("**/api/jobs/*", async (route) => {
    const raw = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const job = /^\d+$/.test(raw) ? await getJob(db, Number(raw), attributionFor) : null;
    if (!job) return route.fulfill({ status: 404, json: { error: { code: "not_found", message: "Vaga não encontrada." } } });
    return route.fulfill({ json: job });
  });
  await page.route("**/api/jobs?*", async (route) => {
    const parsed = parseJobsQuery(new URL(route.request().url()).searchParams);
    if (!parsed.ok) return route.fulfill({ status: 400, json: { error: parsed.error } });
    const result = await listJobs(db, parsed.value, !parsed.value.cursor);
    return route.fulfill({ json: { ...result, lastCollectedAt: new Date(Date.now() - 10 * MINUTE).toISOString() } });
  });
});

test.afterEach(() => {
  expect(problems, "sem violações de CSP nem erros de página").toEqual([]);
});

const panel = (page: Page) => page.getByRole("region", { name: "Análise com IA" });

test("analisa a vaga, mostra o resultado como texto, persiste no reload e não envia dados de contato", async ({ page }) => {
  await seedStorage(page, { [AI_KEY]: AI_SETTINGS, [PROFILE_KEY]: PROFILE });
  await page.goto("/vagas/1");
  await panel(page).getByRole("button", { name: "Analisar com IA" }).click();

  await expect(panel(page).getByRole("heading", { name: "Pontos fortes" })).toBeVisible();
  await expect(panel(page).getByText("6 anos com React em produto de grande escala.")).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "Lacunas" })).toBeVisible();
  await expect(panel(page).getByText("GraphQL não aparece no seu currículo (importante).")).toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "Palavras-chave que faltam no CV" })).toBeVisible();
  await expect(panel(page).getByText("Core Web Vitals")).toBeVisible();
  // Nota do modelo (140) fica limitada a 100.
  await expect(panel(page).getByText("Nota revisada: 100")).toBeVisible();
  await expect(panel(page).getByText("Gerada com deepseek-chat via DeepSeek")).toBeVisible();

  // A saída da IA é texto: o payload aparece literal, sem criar elemento nem executar.
  await expect(panel(page).getByText(XSS, { exact: true })).toBeVisible();
  await expect(panel(page).locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: boolean }).__xss)).toBeUndefined();

  // Minimização: nada de contato no corpo enviado.
  expect(mock.bodies).toHaveLength(1);
  const sent = mock.bodies[0];
  for (const secret of [EMAIL, PHONE_DIGITS, STREET, "Ana Exemplo", "github.com/ana-exemplo"]) expect(sent).not.toContain(secret);
  expect(sent).toContain("React");

  const stored = await page.evaluate((k) => window.localStorage.getItem(k), ANALYSIS_KEY);
  expect(JSON.parse(stored ?? "{}").data["1"]).toMatchObject({ model: "deepseek-chat", provider: "deepseek", revisedScore: 100 });

  // Reload: o resultado volta do localStorage, sem nova chamada.
  await page.reload();
  await expect(panel(page).getByText("Core Web Vitals")).toBeVisible();
  await expect(panel(page).getByText("Gerada com deepseek-chat via DeepSeek")).toBeVisible();
  expect(mock.bodies).toHaveLength(1);

  // Analisar de novo substitui a análise salva.
  await panel(page).getByRole("button", { name: "Analisar de novo" }).click();
  await expect.poll(() => mock.bodies.length).toBe(2);
  await expect(panel(page).getByRole("button", { name: "Analisar de novo" })).toBeEnabled();
});

test("erro 402 mostra 'Sem crédito, recarregue' com 'Tentar de novo', que refaz a chamada", async ({ page }) => {
  await seedStorage(page, { [AI_KEY]: AI_SETTINGS, [PROFILE_KEY]: PROFILE });
  mock.statuses.push(402);
  await page.goto("/vagas/1");
  await panel(page).getByRole("button", { name: "Analisar com IA" }).click();

  await expect(panel(page).getByText("Sem crédito, recarregue")).toBeVisible();
  await panel(page).getByRole("button", { name: "Tentar de novo" }).click();
  await expect(panel(page).getByText("Core Web Vitals")).toBeVisible();
  expect(mock.bodies).toHaveLength(2);
});

test("sem perfil, convida a importar o currículo", async ({ page }) => {
  await seedStorage(page, { [AI_KEY]: AI_SETTINGS });
  await page.goto("/vagas/1");
  const link = panel(page).getByRole("link", { name: "Importar currículo" });
  await expect(link).toHaveAttribute("href", "/perfil");
  await expect(panel(page).getByRole("button", { name: "Analisar com IA" })).toHaveCount(0);
});

test("sem provedor de IA, convida a conectar uma IA", async ({ page }) => {
  await seedStorage(page, { [PROFILE_KEY]: PROFILE });
  await page.goto("/vagas/1");
  await expect(panel(page).getByRole("link", { name: "Conecte uma IA em Configurações" })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Analisar com IA" })).toHaveCount(0);
});
