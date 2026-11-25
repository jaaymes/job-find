import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type Page, type Route } from "@playwright/test";
import { extractText, getDocumentProxy } from "unpdf";
import { cvFileName } from "@/lib/client/pdf/filename";
import { getJob, listJobs } from "@/lib/server/jobs/query";
import { attributionFor } from "@/lib/server/sources/registry";
import { parseJobsQuery } from "@/lib/shared/schemas/jobs-query";
import { MINUTE, seedDatabase, type E2eDb } from "./seed";

// US-06: tela do gerador de CV e carta (`/gerador/<id>`). O provedor (DeepSeek) é mockado; o streaming usa um
// servidor real em loopback (IA local). A tela roda sob a CSP real das rotas (local): qualquer violação reprova.

const AI_KEY = "jobfind:v1:ai";
const PROFILE_KEY = "jobfind:v1:profile";
const DOCS_KEY = "jobfind:v1:generatedDocs";
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
    summary: `Desenvolvedora com React e TypeScript. Moro na ${STREET}.`,
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
        bullets: [
          { id: "exp_1.b1", text: "Reduziu o tempo de carregamento em 40% com React" },
          { id: "exp_1.b2", text: "Liderou a migração do front-end para Next.js" },
        ],
      },
    ],
    education: [],
  },
};

const AI_SETTINGS = {
  v: 1,
  data: {
    providers: { deepseek: { key: "sk-test-deepseek-1234", addedAt: "2026-11-20T00:00:00.000Z", source: "paste", privacyAccepted: true } },
    tasks: { extract: null, analyze: null, cv: null },
    dataCollectionDeny: true,
    minimizePii: true,
  },
};

const GOOD_BULLET = "Reduziu o tempo de carregamento em 40% com React.";
const INVENTED_BULLET = "Aumentou a conversão do checkout em 85%.";
const LONG_BULLET =
  "Reduziu o tempo de carregamento em 40% com React, mantendo a interface estável e acessível para todas as pessoas usuárias do produto.";

type Docs = {
  cv: {
    headline: string;
    summary: string;
    skills: string[];
    experiences: { expId: string; bullets: { text: string; sourceBulletIds: string[] }[] }[];
  };
  coverLetter: string | null;
};

type Mock = { bodies: string[]; statuses: number[]; invent: boolean; many: boolean; badLetter: boolean };

/** Resposta do modelo conforme o pedido: idioma (EN quando o prompt pede English) e carta (quando pedida). */
function docsFor(body: string, m: Mock): Docs {
  const en = body.includes("Escreva tudo em English");
  const letter = body.includes("Gere também a carta");
  const bullets = m.many
    ? Array.from({ length: 60 }, () => ({ text: LONG_BULLET, sourceBulletIds: ["exp_1.b1"] }))
    : en
      ? [{ text: "Cut page load time by 40% using React.", sourceBulletIds: ["exp_1.b1"] }]
      : [
          { text: GOOD_BULLET, sourceBulletIds: ["exp_1.b1"] },
          ...(m.invent ? [{ text: INVENTED_BULLET, sourceBulletIds: ["exp_1.b2"] }] : []),
        ];
  const coverLetter = !letter
    ? null
    : en
      ? "Dear team, I have experience with React and TypeScript and I would like to contribute."
      : m.badLetter
        ? "Prezada equipe, tenho experiência com React e TypeScript e entreguei 300 projetos."
        : "Prezada equipe, tenho experiência com React e TypeScript e quero contribuir com o time.";
  return {
    cv: {
      headline: en ? "Senior Full Stack Developer" : "Desenvolvedora Full Stack",
      summary: en ? "Developer with experience in React and TypeScript." : "Desenvolvedora com experiência em React e TypeScript.",
      skills: ["React", "TypeScript"],
      experiences: [{ expId: "exp_1", bullets }],
    },
    coverLetter,
  };
}

const cors = (route: Route): Record<string, string> => ({
  "access-control-allow-origin": "*",
  "access-control-allow-headers": route.request().headers()["access-control-request-headers"] ?? "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
});

const chunk = (delta: object, finish: string | null) =>
  `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

function sse(content: string): string {
  return (
    chunk({ role: "assistant", content: "" }, null) +
    chunk({ content }, null) +
    chunk({}, "stop") +
    `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "m", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n` +
    "data: [DONE]\n\n"
  );
}

async function mockAi(page: Page): Promise<Mock> {
  const mock: Mock = { bodies: [], statuses: [], invent: true, many: false, badLetter: false };
  await page.route(
    (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
    (route) => route.fulfill({ status: 503, headers: cors(route), body: "não mockado" }),
  );
  await page.route(CHAT_URL, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(route) });
    const body = route.request().postData() ?? "";
    mock.bodies.push(body);
    const status = mock.statuses.shift() ?? 200;
    if (status !== 200) {
      return route.fulfill({ status, headers: cors(route), contentType: "application/json", body: JSON.stringify({ error: { message: "x" } }) });
    }
    return route.fulfill({ status: 200, headers: cors(route), contentType: "text/event-stream", body: sse(JSON.stringify(docsFor(body, mock))) });
  });
  return mock;
}

async function seedStorage(page: Page, entries: Record<string, unknown>) {
  await page.addInitScript(
    (e) => {
      for (const [k, v] of Object.entries(e)) if (!window.localStorage.getItem(k)) window.localStorage.setItem(k, JSON.stringify(v));
    },
    entries,
  );
}

async function storedRec(page: Page): Promise<{ edits: { cv: { headline: string } } | null; approvedFlags: string[] } & Record<string, unknown>> {
  return JSON.parse((await page.evaluate((k) => window.localStorage.getItem(k), DOCS_KEY)) ?? "{}").data?.["1"] ?? null;
}

async function pdfText(path: string): Promise<string> {
  const doc = await getDocumentProxy(new Uint8Array(await readFile(path)));
  return (await extractText(doc, { mergePages: true })).text;
}

async function downloadPdf(page: Page, button: string, prefix: string) {
  const [download] = await Promise.all([
    // O iframe de pré-visualização pode disparar um download próprio (Chromium sem visualizador de PDF): filtra pelo nome.
    page.waitForEvent("download", { predicate: (d) => d.suggestedFilename().startsWith(prefix) }),
    page.getByRole("button", { name: button }).click(),
  ]);
  return { name: download.suggestedFilename(), text: await pdfText(await download.path()) };
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
    if (/^CSP |content security policy|refused to (load|apply|execute|connect|create|frame)/i.test(msg.text())) problems.push(msg.text());
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

const GENERATE = "Gerar CV para esta vaga";
const FIRST = { timeout: 60_000 };
const headline = (page: Page) => page.getByLabel("Título profissional");
const banner = (page: Page) => page.getByRole("status").filter({ hasText: /trecho|Nenhum trecho/ });
// O Next injeta um anunciador de rota com role="alert" (vazio): só contam alertas com texto.
const alerts = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });
const bulletBox = (page: Page, n: number) => page.getByLabel(new RegExp(`^Bullet ${n} de Empresa Ficticia`));

async function generate(page: Page, id = 1) {
  await seedStorage(page, { [AI_KEY]: AI_SETTINGS, [PROFILE_KEY]: PROFILE });
  await page.goto(`/gerador/${id}`);
  await page.getByRole("button", { name: GENERATE }).click();
  await expect(headline(page)).toBeVisible(FIRST);
}

test("gera o CV no idioma da vaga, destaca o trecho inventado, mantém fora do PDF até aprovar e restaura no reload", async ({ page }) => {
  await generate(page);
  await expect(headline(page)).toHaveValue("Desenvolvedora Full Stack");
  await expect(page.getByLabel("Resumo")).toHaveValue(/React e TypeScript/);
  await expect(bulletBox(page, 1)).toHaveValue(GOOD_BULLET);
  await expect(bulletBox(page, 2)).toHaveValue(INVENTED_BULLET);

  // O número inventado (85%) é destacado, conta no banner e justifica "Aprovar mesmo assim".
  await expect(banner(page)).toHaveText(/^1 trecho precisa da sua revisão/);
  const flagged = page.locator('[data-flagged="true"]');
  await expect(flagged).toHaveCount(1);
  await expect(flagged.locator("li").filter({ hasText: "85%" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Pontos de atenção" })).toContainText("85%");

  // A retentativa do validador (RN-07) levou o feedback ao modelo; o texto final ainda traz o trecho, agora destacado.
  expect(mock.bodies).toHaveLength(2);
  expect(mock.bodies[1]).toContain("rejeitada");
  for (const body of mock.bodies) {
    for (const secret of [EMAIL, PHONE_DIGITS, STREET, "Ana Exemplo", "github.com/ana-exemplo"]) expect(body).not.toContain(secret);
    expect(body).toContain("React");
  }

  // PDF: nome padrão e trecho em revisão fora do arquivo.
  const expected = cvFileName("Ana Exemplo", "Empresa 00", "Vaga 00 Desenvolvedor");
  const before = await downloadPdf(page, "Baixar PDF", "CV-");
  expect(before.name).toBe(expected);
  expect(before.text).toContain("40%");
  expect(before.text).not.toContain("85%");

  await flagged.getByRole("button", { name: "Aprovar mesmo assim" }).click();
  await expect(banner(page)).toHaveText(/Nenhum trecho/);
  await expect(page.locator('[data-flagged="true"]')).toHaveCount(0);
  const after = await downloadPdf(page, "Baixar PDF", "CV-");
  expect(after.name).toBe(expected);
  expect(after.text).toContain("85%");

  // Edita um trecho: a aprovação vale por trecho e a edição fica salva.
  await headline(page).fill("Desenvolvedora Full Stack e React");
  // As edições são gravadas com um pequeno atraso (debounce).
  await expect.poll(async () => storedRec(page).then((r) => r?.edits?.cv.headline)).toBe("Desenvolvedora Full Stack e React");
  const rec = await storedRec(page);
  expect(rec).toMatchObject({ provider: "deepseek", model: "deepseek-chat", promptVersion: 1, lang: "pt", includeLetter: false });
  expect(rec.edits?.cv.headline).toBe("Desenvolvedora Full Stack e React");
  expect(rec.approvedFlags).toHaveLength(1);

  // Reload: documentos, edições e aprovações voltam do localStorage, sem nova chamada ao provedor.
  const calls = mock.bodies.length;
  await page.reload();
  await expect(headline(page)).toHaveValue("Desenvolvedora Full Stack e React");
  await expect(bulletBox(page, 2)).toHaveValue(INVENTED_BULLET);
  await expect(banner(page)).toHaveText(/Nenhum trecho/);
  await expect(page.getByRole("button", { name: "Regenerar" })).toBeVisible();
  expect(mock.bodies).toHaveLength(calls);
});

test("editar um bullet para algo inventado faz o validador destacar de novo e bloqueia o PDF do trecho", async ({ page }) => {
  mock.invent = false;
  await generate(page);
  await expect(banner(page)).toHaveText(/Nenhum trecho/);
  await bulletBox(page, 1).fill("Reduziu o tempo de carregamento em 99% com React.");
  await expect(banner(page)).toHaveText(/^1 trecho precisa da sua revisão/);
  const { text } = await downloadPdf(page, "Baixar PDF", "CV-");
  expect(text).not.toContain("99%");
});

test("o resultado parcial aparece enquanto a IA responde e dá para cancelar", async ({ page }) => {
  mock.invent = false;
  const docs = docsFor("", mock);
  const content = JSON.stringify(docs);
  const cut = content.indexOf('"experiences"');
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const server: Server = createServer((req, res) => {
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": String(req.headers["access-control-request-headers"] ?? "*"),
      "access-control-allow-methods": "POST,OPTIONS",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, headers);
      res.end();
      return;
    }
    req.resume();
    res.writeHead(200, { ...headers, "content-type": "text/event-stream" });
    res.write(chunk({ role: "assistant", content: "" }, null));
    res.write(chunk({ content: content.slice(0, cut) }, null));
    void gate.then(() => {
      res.write(chunk({ content: content.slice(cut) }, null));
      res.write(chunk({}, "stop"));
      res.write("data: [DONE]\n\n");
      res.end();
    });
    res.on("close", () => release());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  try {
    const local = {
      v: 1,
      data: {
        providers: { local: { baseURL: `http://127.0.0.1:${port}/v1`, addedAt: "2026-11-20T00:00:00.000Z", source: "paste" } },
        tasks: { extract: null, analyze: null, cv: null },
        dataCollectionDeny: true,
      },
    };
    await seedStorage(page, { [AI_KEY]: local, [PROFILE_KEY]: PROFILE });
    await page.goto("/gerador/1");
    await page.getByRole("button", { name: GENERATE }).click();

    // Parcial: título e resumo já aparecem como texto, com a geração ainda em curso.
    const partial = page.getByRole("region", { name: "Geração em andamento" });
    await expect(partial).toContainText("Desenvolvedora Full Stack", FIRST);
    await expect(partial).toContainText("React e TypeScript");
    await expect(page.getByRole("status").filter({ hasText: "Gerando" })).toBeVisible();
    await expect(headline(page)).toHaveCount(0);

    release();
    await expect(headline(page)).toHaveValue("Desenvolvedora Full Stack", FIRST);
    await expect(partial).toHaveCount(0);
  } finally {
    release();
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("cancelar interrompe a geração sem erro e sem salvar nada", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(CHAT_URL, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(route) });
    await gate;
    await route.abort().catch(() => {});
  });
  await seedStorage(page, { [AI_KEY]: AI_SETTINGS, [PROFILE_KEY]: PROFILE });
  await page.goto("/gerador/1");
  // "Gerando" aparece antes de o módulo de geração carregar: espera a requisição sair, senão o cancelamento
  // chega antes dela e não há requisição para falhar (corrida do teste, não do app).
  const sent = page.waitForRequest((r) => r.url() === CHAT_URL && r.method() === "POST");
  await page.getByRole("button", { name: GENERATE }).click();
  await expect(page.getByRole("status").filter({ hasText: "Gerando" })).toBeVisible();
  await sent;
  // O cancelamento aborta a requisição no navegador: espera a falha dela antes de olhar o armazenamento.
  const aborted = page.waitForEvent("requestfailed", (r) => r.url() === CHAT_URL && r.method() === "POST");
  await page.getByRole("button", { name: "Cancelar" }).click();
  await aborted;
  await expect(page.getByRole("button", { name: GENERATE })).toBeEnabled();
  await expect(alerts(page)).toHaveCount(0);
  release();
  expect(await page.evaluate((k) => window.localStorage.getItem(k), DOCS_KEY)).toBeNull();
});

test("trocar o idioma para EN refaz a geração em inglês; com edições, pede confirmação", async ({ page }) => {
  mock.invent = false;
  await generate(page);
  await expect(page.getByLabel("Idioma do CV")).toHaveValue("pt");
  await headline(page).fill("Desenvolvedora Full Stack e React");

  await page.getByLabel("Idioma do CV").selectOption("en");
  await expect(page.getByText("Suas edições serão descartadas")).toBeVisible();
  // Manter as edições cancela a troca.
  await page.getByRole("button", { name: "Manter edições" }).click();
  await expect(page.getByLabel("Idioma do CV")).toHaveValue("pt");
  await expect(headline(page)).toHaveValue("Desenvolvedora Full Stack e React");
  expect(mock.bodies).toHaveLength(1);

  await page.getByLabel("Idioma do CV").selectOption("en");
  await page.getByRole("button", { name: "Descartar e gerar" }).click();
  await expect(headline(page)).toHaveValue("Senior Full Stack Developer", FIRST);
  await expect(page.getByLabel("Idioma do CV")).toHaveValue("en");
  expect(mock.bodies).toHaveLength(2);
  expect(mock.bodies[1]).toContain("Escreva tudo em English");
  await expect(bulletBox(page, 1)).toHaveValue("Cut page load time by 40% using React.");
  expect(await storedRec(page)).toMatchObject({ lang: "en", edits: null, approvedFlags: [] });
  // Título realista em EN com perfil em PT: sem falso positivo e sem retentativa do validador.
  await expect(banner(page)).toHaveText(/Nenhum trecho/);
});

test("o idioma padrão segue o da vaga (vaga em inglês começa em EN)", async ({ page }) => {
  await seedStorage(page, { [AI_KEY]: AI_SETTINGS, [PROFILE_KEY]: PROFILE });
  await page.goto("/gerador/2");
  await expect(page.getByLabel("Idioma do CV")).toHaveValue("en");
  await page.getByRole("button", { name: GENERATE }).click();
  await expect(headline(page)).toHaveValue("Senior Full Stack Developer", FIRST);
  expect(mock.bodies[0]).toContain("Escreva tudo em English");
});

test("'Incluir carta' gera a carta na aba própria, editável e baixável em PDF", async ({ page }) => {
  mock.invent = false;
  await seedStorage(page, { [AI_KEY]: AI_SETTINGS, [PROFILE_KEY]: PROFILE });
  await page.goto("/gerador/1");
  await expect(page.getByRole("tab", { name: "Carta de apresentação" })).toHaveCount(0);
  await page.getByLabel("Incluir carta de apresentação").check();
  await page.getByRole("button", { name: GENERATE }).click();
  await expect(headline(page)).toBeVisible(FIRST);
  expect(mock.bodies[0]).toContain("Gere também a carta");

  // Abas no padrão WAI-ARIA: só a ativa no Tab, setas trocam a aba, aba e painel ligados por id.
  const cvTab = page.getByRole("tab", { name: "Currículo" });
  const letterTab = page.getByRole("tab", { name: "Carta de apresentação" });
  await expect(cvTab).toHaveAttribute("tabindex", "0");
  await expect(letterTab).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("tabpanel", { name: "Currículo" })).toBeVisible();
  await cvTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(letterTab).toHaveAttribute("aria-selected", "true");
  await expect(letterTab).toBeFocused();
  await expect(page.getByRole("tabpanel", { name: "Carta de apresentação" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(cvTab).toHaveAttribute("aria-selected", "true");

  await letterTab.click();
  const letter = page.getByLabel("Texto da carta");
  await expect(letter).toHaveValue(/quero contribuir com o time/);
  await letter.fill("Prezada equipe, tenho experiência com React e quero contribuir com o time.");
  const { name, text } = await downloadPdf(page, "Baixar carta (PDF)", "Carta-");
  expect(name).toBe(cvFileName("Ana Exemplo", "Empresa 00", "Vaga 00 Desenvolvedor").replace(/^CV/, "Carta"));
  expect(text).toContain("quero contribuir com o time");

  // Reload: a carta editada continua lá e a aba volta a existir.
  await page.reload();
  await page.getByRole("tab", { name: "Carta de apresentação" }).click();
  await expect(page.getByLabel("Texto da carta")).toHaveValue(/tenho experiência com React e quero contribuir/);
});

test("carta com número inventado fica destacada e o download é bloqueado até aprovar", async ({ page }) => {
  mock.invent = false;
  mock.badLetter = true;
  await seedStorage(page, { [AI_KEY]: AI_SETTINGS, [PROFILE_KEY]: PROFILE });
  await page.goto("/gerador/1");
  await page.getByLabel("Incluir carta de apresentação").check();
  await page.getByRole("button", { name: GENERATE }).click();
  await expect(headline(page)).toBeVisible(FIRST);
  await expect(banner(page)).toHaveText(/^1 trecho precisa da sua revisão/);

  await page.getByRole("tab", { name: "Carta de apresentação" }).click();
  await expect(page.getByRole("button", { name: "Baixar carta (PDF)" })).toBeDisabled();
  // A carta em revisão não vira PDF nem na pré-visualização (o visualizador do iframe permitiria baixar).
  await expect(page.getByText("Aprove ou corrija o trecho da carta para ver o PDF.")).toBeVisible();
  await expect(page.locator("iframe[title='Pré-visualização do PDF']")).toHaveCount(0);
  await page.locator('[data-flagged="true"]').getByRole("button", { name: "Aprovar mesmo assim" }).click();
  await expect(page.getByRole("button", { name: "Baixar carta (PDF)" })).toBeEnabled();
  await expect(page.locator("iframe[title='Pré-visualização do PDF']")).toHaveAttribute("src", /^blob:/, FIRST);
  await expect(banner(page)).toHaveText(/Nenhum trecho/);
});

test("429 mostra 'Tentar de novo' e as edições continuam lá; a nova tentativa funciona", async ({ page }) => {
  mock.invent = false;
  await generate(page);
  await headline(page).fill("Desenvolvedora Full Stack e React");

  mock.statuses.push(429);
  await page.getByRole("button", { name: "Regenerar" }).click();
  await expect(page.getByText("Suas edições serão descartadas")).toBeVisible();
  await page.getByRole("button", { name: "Descartar e gerar" }).click();

  await expect(alerts(page).filter({ hasText: "Limite de uso atingido" })).toBeVisible();
  await expect(headline(page)).toHaveValue("Desenvolvedora Full Stack e React");
  await expect.poll(async () => storedRec(page).then((r) => r?.edits?.cv.headline)).toBe("Desenvolvedora Full Stack e React");

  // A confirmação já foi dada e nada mudou: tentar de novo não pergunta outra vez.
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(headline(page)).toHaveValue("Desenvolvedora Full Stack", FIRST);
  await expect(alerts(page)).toHaveCount(0);
});

test("editar depois de uma falha: 'Tentar de novo' pede confirmação de novo", async ({ page }) => {
  mock.invent = false;
  await generate(page);
  mock.statuses.push(429);
  await page.getByRole("button", { name: "Regenerar" }).click(); // sem edições: não pergunta
  await expect(alerts(page).filter({ hasText: "Limite de uso atingido" })).toBeVisible();
  const calls = mock.bodies.length;

  await headline(page).fill("Desenvolvedora Full Stack e React");
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(page.getByText("Suas edições serão descartadas")).toBeVisible();
  expect(mock.bodies).toHaveLength(calls);
  await expect(headline(page)).toHaveValue("Desenvolvedora Full Stack e React");

  await page.getByRole("button", { name: "Descartar e gerar" }).click();
  await expect(headline(page)).toHaveValue("Desenvolvedora Full Stack", FIRST);
  expect(mock.bodies).toHaveLength(calls + 1);
});

test("avisa quando o CV passa de 2 páginas", async ({ page }) => {
  mock.many = true;
  await generate(page);
  await expect(page.getByText(/passou de 2 páginas/)).toBeVisible(FIRST);
});

test("o CV de 1 página não mostra o aviso de páginas", async ({ page }) => {
  mock.invent = false;
  await generate(page);
  await expect(page.locator("iframe[title='Pré-visualização do PDF']")).toHaveAttribute("src", /^blob:/, FIRST);
  await expect(page.getByText(/passou de 2 páginas/)).toHaveCount(0);
});

test("vaga inexistente mostra 'Vaga não encontrada' com link para a lista", async ({ page }) => {
  await seedStorage(page, { [AI_KEY]: AI_SETTINGS, [PROFILE_KEY]: PROFILE });
  await page.goto("/gerador/99999");
  await expect(page.getByRole("heading", { name: "Vaga não encontrada" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver todas as vagas" })).toHaveAttribute("href", "/");
});

test("sem perfil, convida a importar o currículo", async ({ page }) => {
  await seedStorage(page, { [AI_KEY]: AI_SETTINGS });
  await page.goto("/gerador/1");
  await expect(page.getByRole("link", { name: "Importar currículo" })).toHaveAttribute("href", "/perfil");
  await expect(page.getByRole("button", { name: GENERATE })).toHaveCount(0);
});

test("sem provedor de IA, convida a conectar uma IA", async ({ page }) => {
  await seedStorage(page, { [PROFILE_KEY]: PROFILE });
  await page.goto("/gerador/1");
  await expect(page.getByRole("link", { name: "Conecte uma IA em Configurações" })).toBeVisible();
  await expect(page.getByRole("button", { name: GENERATE })).toHaveCount(0);
});

test("provedor com aviso de privacidade pendente leva às Configurações", async ({ page }) => {
  const pending = structuredClone(AI_SETTINGS);
  pending.data.tasks.cv = { provider: "deepseek", model: "deepseek-chat" } as never;
  (pending.data.providers.deepseek as { privacyAccepted: boolean }).privacyAccepted = false;
  await seedStorage(page, { [AI_KEY]: pending, [PROFILE_KEY]: PROFILE });
  await page.goto("/gerador/1");
  await expect(page.getByRole("link", { name: "Conecte uma IA em Configurações" })).toBeVisible();
});

test("o detalhe da vaga tem o link 'Gerar CV + carta'", async ({ page }) => {
  // Sem currículo importado o detalhe mostra o botão desabilitado ("precisa do currículo"), não o link.
  await seedStorage(page, { [PROFILE_KEY]: PROFILE });
  await page.goto("/vagas/1");
  await expect(page.getByRole("link", { name: "Gerar CV + carta" })).toHaveAttribute("href", "/gerador/1");
});

/** URL do documento carregado (muda só em navegação completa; a navegação no cliente mantém a do 1º documento). */
const documentUrl = (page: Page) => page.evaluate(() => (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming).name);

test("da vaga ao gerador pelo botão: navegação completa, gera e baixa o PDF sem violação de CSP", async ({ page }) => {
  mock.invent = false;
  await seedStorage(page, { [AI_KEY]: AI_SETTINGS, [PROFILE_KEY]: PROFILE });
  await page.goto("/vagas/1");
  await page.getByRole("link", { name: "Gerar CV + carta" }).click();
  await expect(page).toHaveURL(/\/gerador\/1$/);
  // O documento foi buscado de novo: vale a CSP de nonce das rotas (local), não a pública da vaga.
  await expect.poll(() => documentUrl(page)).toMatch(/\/gerador\/1$/);
  await page.getByRole("button", { name: GENERATE }).click();
  await expect(headline(page)).toBeVisible(FIRST);
  await expect(page.locator("iframe[title='Pré-visualização do PDF']")).toHaveAttribute("src", /^blob:/, FIRST);
  const { name, text } = await downloadPdf(page, "Baixar PDF", "CV-");
  expect(name).toBe(cvFileName("Ana Exemplo", "Empresa 00", "Vaga 00 Desenvolvedor"));
  expect(text).toContain("40%");
  // `afterEach`: nenhuma violação de CSP nem erro de página.
});

test("de / para /perfil pelo cabeçalho: a página local roda WebAssembly (CSP de nonce)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Perfil" }).click();
  await expect(page).toHaveURL(/\/perfil$/);
  await expect(page.getByRole("navigation", { name: "Principal" }).getByRole("link", { name: "Perfil" })).toHaveAttribute("aria-current", "page");
  // Módulo WebAssembly mínimo (cabeçalho "\0asm" v1). Com a CSP pública (sem 'wasm-unsafe-eval'), dá CompileError.
  const ok = await page.evaluate(async () => {
    try {
      await WebAssembly.instantiate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
      return "ok";
    } catch (e) {
      return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
  });
  expect(ok).toBe("ok");
  expect(await documentUrl(page)).toMatch(/\/perfil$/);
});

test("'Regenerar' pede confirmação também quando só há aprovações (sem edições)", async ({ page }) => {
  await generate(page);
  await page.locator('[data-flagged="true"]').getByRole("button", { name: "Aprovar mesmo assim" }).click();
  await expect(banner(page)).toHaveText(/Nenhum trecho/);
  await expect.poll(async () => storedRec(page).then((r) => r?.approvedFlags.length)).toBe(1);
  expect((await storedRec(page)).edits).toBeNull();
  const calls = mock.bodies.length;

  await page.getByRole("button", { name: "Regenerar" }).click();
  await expect(page.getByText("Suas edições serão descartadas")).toBeVisible();
  await page.getByRole("button", { name: "Manter edições" }).click();
  expect(mock.bodies).toHaveLength(calls);
  await expect(banner(page)).toHaveText(/Nenhum trecho/);

  await page.getByRole("button", { name: "Regenerar" }).click();
  await page.getByRole("button", { name: "Descartar e gerar" }).click();
  await expect.poll(() => mock.bodies.length).toBeGreaterThan(calls);
  await expect(banner(page)).toHaveText(/^1 trecho precisa da sua revisão/, FIRST);
});

test("trocar o modelo do CV refaz só o PDF (sem nova chamada à IA) e a escolha sobrevive ao reload", async ({ page }) => {
  await generate(page);
  const calls = mock.bodies.length;

  await page.getByRole("button", { name: /^Modelo do CV: / }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("radio")).toHaveCount(10);
  await expect(dialog.getByText("Recomendado para você")).toHaveCount(1);
  await dialog.getByRole("radio", { name: /Harvard/ }).check();

  await expect(page.getByRole("button", { name: "Modelo do CV: Harvard" })).toBeVisible();
  expect(mock.bodies).toHaveLength(calls);
  await expect.poll(async () => (await storedRec(page))?.templateId).toBe("harvard");

  await page.reload();
  await expect(headline(page)).toBeVisible(FIRST);
  await expect(page.getByRole("button", { name: "Modelo do CV: Harvard" })).toBeVisible();
  expect(mock.bodies).toHaveLength(calls);
});
