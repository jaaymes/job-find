import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

// Fase 3: assistente de IA do perfil (entrevista, reescrita, RN-20, RNF-04, RNF-05). O provedor (DeepSeek) é mockado.

const AI_KEY = "jobfind:v1:ai";
const PROFILE_KEY = "jobfind:v1:profile";
const CHAT_URL = "https://api.deepseek.com/v1/chat/completions";
const INVENTED_MESSAGE = "A IA sugeriu fatos que não estão no seu perfil. Tente de novo ou responda com mais detalhes.";

const PROFILE = {
  v: 2,
  data: {
    schemaVersion: 2,
    name: "Ana Exemplo",
    headline: "Desenvolvedora Full Stack",
    location: "São Paulo, SP, Brasil",
    seniority: "senior",
    englishLevel: "advanced",
    summary: null,
    contact: { email: null, phone: null, links: [] },
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
    projects: [],
    certifications: [],
    languages: [],
    highlights: [],
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

const QUESTIONS = ["Em que contexto você trabalha hoje?", "Quais tecnologias você mais usa?", "Qual resultado você mais valoriza?"];
const OPTION_1 = "Desenvolvedora que trabalha com React e TypeScript.";
const OPTION_2 = "Desenvolvedora que trabalha com React e TypeScript e cuida do desempenho das interfaces.";
const BULLETS_OLD = ["Reduziu o tempo de carregamento em 40% com React", "Liderou a migração do front-end para Next.js"];
const BULLETS_NEW = ["Reduziu o carregamento em 40% com React.", "Liderou a migração do front-end para Next.js."];
const BULLETS_DIRECT = ["Cortou o carregamento em 40% com React.", "Liderou a migração do front-end para Next.js."];
const INVENTED_BULLETS = ["Aumentou a conversão do checkout em 85%."];

type Mock = { bodies: string[]; invent: boolean };

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

/** Resposta do modelo conforme a tarefa (o prompt de sistema de cada chamada é distinto). */
function answerFor(body: string, m: Mock): unknown {
  if (body.includes("faça de 3 a 5 perguntas")) return { questions: QUESTIONS };
  if (body.includes("escreva exatamente 2 opções")) return { options: [{ text: OPTION_1, bullets: null }, { text: OPTION_2, bullets: null }] };
  if (body.includes("reescreva o texto atual")) return { draft: { text: null, bullets: m.invent ? INVENTED_BULLETS : body.includes("(mais direto)") ? BULLETS_DIRECT : BULLETS_NEW } };
  throw new Error("chamada de IA inesperada");
}

async function mockAi(page: Page): Promise<Mock> {
  const mock: Mock = { bodies: [], invent: false };
  await page.route(
    (url) => url.hostname !== "localhost" && url.hostname !== "127.0.0.1",
    (route) => route.fulfill({ status: 503, headers: cors(route), body: "não mockado" }),
  );
  await page.route(CHAT_URL, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(route) });
    const body = route.request().postData() ?? "";
    mock.bodies.push(body);
    return route.fulfill({ status: 200, headers: cors(route), contentType: "text/event-stream", body: sse(JSON.stringify(answerFor(body, mock))) });
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

const snapshot = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, string | null> = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)!;
      if (k.startsWith("jobfind:")) out[k] = window.localStorage.getItem(k);
    }
    return out;
  });

const storedSummary = (page: Page) =>
  page.evaluate((k) => (JSON.parse(window.localStorage.getItem(k) ?? "null") as { data: { summary: string | null } } | null)?.data.summary, PROFILE_KEY);

const FIRST = { timeout: 30_000 };
const dialog = (page: Page) => page.getByRole("dialog");
const summary = (page: Page) => page.getByLabel(/^Resumo/);
const alerts = (page: Page) => page.getByRole("alert").filter({ hasText: /\S/ });

let mock: Mock;

test.beforeEach(async ({ page }) => {
  mock = await mockAi(page);
  await seedStorage(page, { [AI_KEY]: AI_SETTINGS, [PROFILE_KEY]: PROFILE });
});

test("entrevista do resumo: escolhe a opção 2, insere só no rascunho, avisa ao sair e persiste ao salvar", async ({ page }) => {
  await page.goto("/perfil");
  await expect(summary(page)).toHaveValue("");
  await page.getByRole("button", { name: "Escrever com IA" }).click();

  const answers = dialog(page).getByRole("textbox");
  await expect(answers).toHaveCount(3, FIRST);
  for (const q of QUESTIONS) await expect(dialog(page).getByText(q)).toBeVisible();
  await answers.nth(0).fill("Trabalho com produtos web.");
  await dialog(page).getByRole("button", { name: "Gerar" }).click();

  await expect(dialog(page).getByRole("radio", { name: "Opção 1" })).toBeChecked(FIRST);
  await dialog(page).getByRole("radio", { name: "Opção 2" }).check();
  await expect(dialog(page).getByRole("textbox")).toHaveValue(OPTION_2);
  await dialog(page).getByRole("button", { name: "Inserir no perfil" }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(summary(page)).toHaveValue(OPTION_2);
  await expect(page.getByText("Texto inserido")).toBeVisible();
  // O assistente só altera o rascunho: o perfil salvo continua sem resumo.
  expect(await storedSummary(page)).toBeNull();

  let mensagem = "";
  page.once("dialog", (d) => {
    mensagem = d.message();
    void d.dismiss();
  });
  await page.getByRole("link", { name: "Minhas vagas" }).first().click();
  expect(mensagem).toBe("Você tem alterações não salvas no perfil. Sair mesmo assim?");
  await expect(page).toHaveURL(/\/perfil$/);

  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Perfil salvo" })).toBeVisible();
  expect(await storedSummary(page)).toBe(OPTION_2);
  await page.reload();
  await expect(summary(page)).toHaveValue(OPTION_2);
});

test("o hub do assistente abre o painel da experiência mesmo fechada", async ({ page }) => {
  await page.goto("/perfil");
  await expect(page.getByRole("heading", { name: "Assistente de IA" })).toBeVisible();
  await page.getByRole("button", { name: "Melhorar experiências com IA" }).click();
  await expect(dialog(page).getByRole("textbox", { name: "Realização 1" })).toHaveValue(BULLETS_NEW[0], FIRST);
});

test("bullets: 'Melhorar com IA' com tom 'Mais direto' insere e 'Desfazer' restaura", async ({ page }) => {
  await page.goto("/perfil");
  await page.getByRole("button", { name: /^Editar experiência/ }).click();
  await page.getByRole("group", { name: "Realizações" }).getByRole("button", { name: "Melhorar com IA" }).click();

  await expect(dialog(page).getByRole("textbox", { name: "Realização 1" })).toHaveValue(BULLETS_NEW[0], FIRST);
  await dialog(page).getByLabel("Tom").selectOption({ label: "Mais direto" });
  await dialog(page).getByRole("button", { name: "Gerar de novo" }).click();
  // O valor novo só aparece se a 2ª chamada pediu o tom escolhido ("Tom: direct (mais direto)").
  await expect(dialog(page).getByRole("textbox", { name: "Realização 1" })).toHaveValue(BULLETS_DIRECT[0], FIRST);
  expect(mock.bodies).toHaveLength(2);
  expect(mock.bodies[0]).not.toContain("(mais direto)");
  expect(mock.bodies[1]).toContain("(mais direto)");
  await dialog(page).getByRole("button", { name: "Inserir no perfil" }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByLabel("Realização 1", { exact: true })).toHaveValue(BULLETS_DIRECT[0]);
  await expect(page.getByLabel("Realização 2", { exact: true })).toHaveValue(BULLETS_DIRECT[1]);
  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(page.getByLabel("Realização 1", { exact: true })).toHaveValue(BULLETS_OLD[0]);
  await expect(page.getByLabel("Realização 2", { exact: true })).toHaveValue(BULLETS_OLD[1]);
});

test("número inventado nas 2 chamadas mostra a mensagem do RN-20 e não insere nada", async ({ page }) => {
  mock.invent = true;
  await page.goto("/perfil");
  await page.getByRole("button", { name: /^Editar experiência/ }).click();
  await page.getByRole("group", { name: "Realizações" }).getByRole("button", { name: "Melhorar com IA" }).click();

  await expect(alerts(page).filter({ hasText: INVENTED_MESSAGE })).toBeVisible(FIRST);
  expect(mock.bodies).toHaveLength(2);
  await expect(dialog(page).getByRole("button", { name: "Inserir no perfil" })).toBeDisabled();
  await expect(dialog(page).getByRole("button", { name: "Tentar de novo" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByLabel("Realização 1", { exact: true })).toHaveValue(BULLETS_OLD[0]);
  await expect(page.getByLabel("Realização 2", { exact: true })).toHaveValue(BULLETS_OLD[1]);
});

test("RNF-04: responder e fechar o painel sem inserir não grava nada no localStorage", async ({ page }) => {
  await page.goto("/perfil");
  await expect(page.getByRole("button", { name: "Escrever com IA" })).toBeVisible();
  const before = await snapshot(page);
  expect(Object.keys(before)).toContain(PROFILE_KEY);

  await page.getByRole("button", { name: "Escrever com IA" }).click();
  const answers = dialog(page).getByRole("textbox");
  await expect(answers).toHaveCount(3, FIRST);
  await answers.nth(0).fill("Resposta que não pode ser gravada.");
  await dialog(page).getByRole("button", { name: "Gerar" }).click();
  await expect(dialog(page).getByRole("radio", { name: "Opção 1" })).toBeChecked(FIRST);

  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
  await expect(summary(page)).toHaveValue("");
  expect(await snapshot(page)).toEqual(before);
});

test("RNF-05: foco no primeiro campo, região aria-live e fluxo só com Tab, Espaço e Enter", async ({ page }) => {
  await page.goto("/perfil");
  const open = page.getByRole("button", { name: "Escrever com IA" });
  await open.focus();
  await page.keyboard.press("Enter");

  const first = dialog(page).getByRole("textbox").first();
  await expect(first).toBeFocused(FIRST);
  const live = dialog(page).locator('[aria-live="polite"]');
  expect(await live.count()).toBeGreaterThan(0);
  // O anúncio é curto e estável: nunca o texto parcial da geração.
  expect(((await live.first().textContent()) ?? "").length).toBeLessThan(40);

  await page.keyboard.type("Trabalho com produtos web.");
  // Pula as perguntas 2 e 3 e vai até "Gerar".
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(dialog(page).getByRole("button", { name: "Gerar" })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(dialog(page).getByRole("radio", { name: "Opção 1" })).toBeFocused(FIRST);
  // Opção 1 (marcada) → texto → "Voltar às respostas" → "Inserir no perfil".
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(dialog(page).getByRole("button", { name: "Inserir no perfil" })).toBeFocused();
  await page.keyboard.press("Space");

  await expect(dialog(page)).toHaveCount(0);
  await expect(summary(page)).toHaveValue(OPTION_1);
});

test("sem IA configurada, o painel pede para conectar uma IA e não chama o provedor", async ({ page }) => {
  // O `beforeEach` já semeou a IA; limpa antes de o app carregar (o init script não recria o que já existe).
  await page.addInitScript((k) => window.localStorage.removeItem(k), AI_KEY);
  await page.goto("/perfil");
  await page.getByRole("button", { name: "Escrever com IA" }).click();
  await expect(dialog(page).getByText("Conecte uma IA para usar o assistente")).toBeVisible();
  expect(mock.bodies).toHaveLength(0);
});

/** Avança com `Tab` de verdade (sem `focus()`) até o elemento receber o foco. */
async function tabTo(page: Page, target: Locator, max = 80, key = "Tab") {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(key);
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`o foco não chegou ao elemento em ${max} Tabs`);
}

test("assistente do resumo só com o teclado: Tab, Enter, setas, Espaço e salvar o perfil", async ({ page }) => {
  await page.goto("/perfil");
  await expect(page.getByRole("button", { name: "Escrever com IA" })).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "Escrever com IA" }));
  await page.keyboard.press("Enter");

  await expect(dialog(page).getByRole("textbox").first()).toBeFocused(FIRST);
  await page.keyboard.type("Trabalho com produtos web.");
  await tabTo(page, dialog(page).getByRole("button", { name: "Gerar" }), 5);
  await page.keyboard.press("Enter");

  const option1 = dialog(page).getByRole("radio", { name: "Opção 1" });
  await expect(option1).toBeFocused(FIRST);
  await page.keyboard.press("ArrowDown");
  await expect(dialog(page).getByRole("radio", { name: "Opção 2" })).toBeChecked();
  await page.keyboard.press("Space");
  await expect(dialog(page).getByRole("radio", { name: "Opção 2" })).toBeChecked();
  await expect(dialog(page).getByRole("textbox")).toHaveValue(OPTION_2);
  await tabTo(page, dialog(page).getByRole("button", { name: "Inserir no perfil" }), 5);
  await page.keyboard.press("Enter");

  await expect(dialog(page)).toHaveCount(0);
  await expect(summary(page)).toHaveValue(OPTION_2);
  // "Salvar perfil" fica antes do resumo no DOM; o foco volta ao botão do assistente, então a volta é com Shift+Tab.
  await tabTo(page, page.getByRole("button", { name: "Salvar perfil" }), 80, "Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Perfil salvo" })).toBeVisible();
  expect(await storedSummary(page)).toBe(OPTION_2);
});
