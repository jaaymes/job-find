import { resolve } from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

const AI_KEY = "jobfind:v1:ai";
const PROFILE_KEY = "jobfind:v1:profile";
const CHAT_URL = "https://api.deepseek.com/v1/chat/completions";
const CV_DIR = resolve(import.meta.dirname, "../fixtures/cv");
const fixture = (name: string) => resolve(CV_DIR, name);

// Dados fictícios das fixtures (tests/fixtures/cv/generate.mjs).
const CV_EMAIL = "ana.exemplo@exemplo.test";
const CV_PHONE_DIGITS = "98888-7777";

const cors = (route: Route): Record<string, string> => ({
  "access-control-allow-origin": "*",
  "access-control-allow-headers": route.request().headers()["access-control-request-headers"] ?? "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
});

function modelProfile(name: string) {
  return {
    schemaVersion: 1,
    name,
    headline: "Desenvolvedora Full Stack",
    location: "São Paulo, BR",
    seniority: "mid",
    englishLevel: "advanced",
    summary: "Seis anos de experiência.",
    contact: { email: null, phone: null, links: [] },
    skills: [
      { name: "TypeScript", years: 6, stackId: null },
      { name: "ReactJS", years: 5, stackId: null },
    ],
    experiences: [
      {
        id: "exp_1",
        company: "Empresa Ficticia Ltda",
        title: "Desenvolvedora Pleno",
        startDate: "2020-01",
        endDate: null,
        bullets: [{ id: "exp_1.b1", text: "Reduziu o tempo de carregamento em 40%" }],
      },
    ],
    education: [],
  };
}

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

type Mock = { bodies: string[]; failNext: number; name: string };

async function mockAi(page: Page): Promise<Mock> {
  const mock: Mock = { bodies: [], failNext: 0, name: "Ana Exemplo" };
  await page.route(
    (url) => url.hostname !== "localhost",
    (route) => route.fulfill({ status: 503, headers: cors(route), body: "não mockado" }),
  );
  await page.route(CHAT_URL, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(route) });
    mock.bodies.push(route.request().postData() ?? "");
    if (mock.failNext > 0) {
      mock.failNext--;
      return route.fulfill({ status: 503, headers: cors(route), contentType: "application/json", body: "{}" });
    }
    return route.fulfill({
      status: 200,
      headers: cors(route),
      contentType: "text/event-stream",
      body: sse(JSON.stringify(modelProfile(mock.name))),
    });
  });
  return mock;
}

async function seedAi(page: Page): Promise<void> {
  const payload = {
    v: 1,
    data: {
      providers: { deepseek: { key: "sk-test-deepseek-1234", addedAt: "2026-11-20T00:00:00.000Z", source: "paste", privacyAccepted: true } },
      tasks: { extract: null, analyze: null, cv: null },
      dataCollectionDeny: true,
      minimizePii: true,
    },
  };
  await page.addInitScript(
    ([k, v]) => {
      if (!window.localStorage.getItem(k)) window.localStorage.setItem(k, v);
    },
    [AI_KEY, JSON.stringify(payload)],
  );
}

/** Registra violações de CSP (evento e console) e devolve uma função que as lista. */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  const problems: string[] = [];
  page.on("console", (msg) => {
    if (/content security policy|refused to (load|apply|execute|connect|create)/i.test(msg.text())) {
      problems.push(msg.text());
    }
  });
  page.on("pageerror", (err) => problems.push(err.message));
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return async () => [
    ...(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)),
    ...problems,
  ];
}

const storedProfile = (page: Page) =>
  page.evaluate((k) => {
    const raw = window.localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as { data: Record<string, unknown> }).data : null;
  }, PROFILE_KEY);

let mock: Mock;

test.beforeEach(async ({ page }) => {
  mock = await mockAi(page);
  await seedAi(page);
});

for (const [file, label] of [
  ["texto.pdf", "PDF"],
  ["cv.docx", "DOCX"],
] as const) {
  test(`upload de ${file} (${label}) mostra o editor preenchido, sem violação de CSP e sem enviar contato à IA`, async ({
    page,
  }) => {
    const violations = await watchCsp(page);
    await page.goto("/perfil");
    await page.getByLabel("Arquivo do currículo (PDF ou DOCX)").setInputFiles(fixture(file));

    await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Ana Exemplo");
    await expect(page.getByRole("heading", { name: "Dados do perfil" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remover ReactJS" })).toBeVisible();
    // E-mail e telefone vêm do texto local, não do modelo.
    await expect(page.getByLabel(/^E-mail/)).toHaveValue(CV_EMAIL);
    await expect(page.getByLabel(/^Telefone/)).toHaveValue(/98888-7777/);
    await expect(page.getByText("Última importação")).toBeVisible();

    expect(mock.bodies).toHaveLength(1);
    expect(mock.bodies[0]).not.toContain(CV_EMAIL);
    expect(mock.bodies[0]).not.toContain(CV_PHONE_DIGITS);
    expect(mock.bodies[0]).toContain("Ana Exemplo"); // o texto do CV chegou ao modelo

    const saved = await storedProfile(page);
    expect((saved?.contact as { email: string }).email).toBe(CV_EMAIL);
    expect((saved?.skills as { stackId: string | null }[])[1].stackId).toBe("react");
    expect(await violations()).toEqual([]);
  });
}

test("PDF escaneado mostra a mensagem e abre o campo de colar texto", async ({ page }) => {
  await page.goto("/perfil");
  await page.getByLabel("Arquivo do currículo (PDF ou DOCX)").setInputFiles(fixture("escaneado.pdf"));
  await expect(page.getByText("Não consegui ler o texto deste PDF; cole o texto do currículo")).toBeVisible();
  const box = page.getByLabel("Texto do currículo", { exact: true });
  await expect(box).toBeVisible();
  await expect(box).toBeFocused();
  // O modal de progresso termina de sair depois (animação) e não pode devolver o foco ao input de arquivo.
  await page.waitForTimeout(500);
  await expect(box).toBeFocused();
  expect(mock.bodies).toHaveLength(0);

  await box.fill("Beatriz Teste\nDesenvolvedora\nSkills: TypeScript");
  await page.getByRole("button", { name: "Analisar com IA" }).click();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Ana Exemplo");
});

test("arquivo de tipo inválido mostra erro em português", async ({ page }) => {
  await page.goto("/perfil");
  await page.getByLabel("Arquivo do currículo (PDF ou DOCX)").setInputFiles(fixture("fake.pdf"));
  await expect(page.getByRole("alert").filter({ hasText: "Use um arquivo PDF ou DOCX." })).toBeVisible();
});

test("erro de rede da IA mostra 'Tentar de novo', que refaz a importação", async ({ page }) => {
  mock.failNext = 1;
  await page.goto("/perfil");
  await page.getByLabel("Arquivo do currículo (PDF ou DOCX)").setInputFiles(fixture("texto.pdf"));
  await expect(page.getByRole("alert").filter({ hasText: "Não foi possível falar com o provedor" })).toBeVisible();
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Ana Exemplo");
});

test("importar com perfil existente pede confirmação de substituição", async ({ page }) => {
  await page.goto("/perfil");
  await page.getByLabel("Arquivo do currículo (PDF ou DOCX)").setInputFiles(fixture("texto.pdf"));
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Ana Exemplo");

  mock.name = "Beatriz Nova";
  await page.getByLabel("Arquivo do currículo (PDF ou DOCX)").setInputFiles(fixture("cv.docx"));
  const dialog = page.getByRole("dialog", { name: "Substituir o perfil atual?" });
  await expect(dialog).toBeVisible();
  // O modal de progresso some antes e não tira o foco da confirmação ao terminar de sair.
  await expect(page.getByRole("dialog", { name: "Importando seu currículo" })).toBeHidden();
  await page.waitForTimeout(500);
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await dialog.getByRole("button", { name: "Manter o perfil atual" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Ana Exemplo");

  await page.getByLabel("Arquivo do currículo (PDF ou DOCX)").setInputFiles(fixture("cv.docx"));
  await dialog.getByRole("button", { name: "Substituir perfil" }).click();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Beatriz Nova");
  expect((await storedProfile(page))?.name).toBe("Beatriz Nova");
});

test("uma edição salva sobrevive ao reload", async ({ page }) => {
  await page.goto("/perfil");
  await page.getByLabel("Arquivo do currículo (PDF ou DOCX)").setInputFiles(fixture("texto.pdf"));
  const nome = page.getByLabel("Nome", { exact: true });
  await expect(nome).toHaveValue("Ana Exemplo");
  await nome.fill("Ana Editada");
  await page.getByRole("button", { name: "Remover TypeScript" }).click();
  await page.getByRole("button", { name: "+ Adicionar", exact: true }).click();
  await page.getByLabel("Nova competência").fill("Rust");
  await page.getByRole("button", { name: "Adicionar competência" }).click();
  await page.getByRole("button", { name: "Editar experiência" }).click();
  await page.getByLabel("Realização 1", { exact: true }).fill("Texto editado <img src=x onerror=alert(1)>");
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Perfil salvo" })).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Ana Editada");
  await expect(page.getByRole("button", { name: "Remover Rust" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remover TypeScript" })).toHaveCount(0);
  // Saída da IA e do usuário é só texto: nada de HTML renderizado.
  await expect(page.getByText("Texto editado <img src=x onerror=alert(1)>")).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(0);
});

test("se o localStorage recusar a gravação, mostra 'Não foi possível salvar'", async ({ page }) => {
  await page.goto("/perfil");
  await page.getByRole("button", { name: "Preencher manualmente" }).click();
  await expect(page.getByRole("heading", { name: "Dados do perfil" })).toBeVisible();
  // Rascunho só em memória: nada gravado antes de "Salvar perfil".
  expect(await storedProfile(page)).toBeNull();
  await page.evaluate(() => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k: string, v: string) {
      if (k === "jobfind:v1:profile") throw new DOMException("cheio", "QuotaExceededError");
      return orig.call(this, k, v);
    };
  });
  await page.getByLabel("Nome", { exact: true }).fill("Fulana");
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Não foi possível salvar" })).toBeVisible();
});

test("headline e links de contato são editáveis (só http/https)", async ({ page }) => {
  await page.goto("/perfil");
  await page.getByRole("button", { name: "Preencher manualmente" }).click();
  await page.getByLabel("Título profissional").fill("Dev Full Stack");
  await page.getByLabel(/Novo link/).fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Adicionar link" }).click();
  await expect(page.getByText("Use um endereço http ou https válido.")).toBeVisible();
  await page.getByLabel(/Novo link/).fill("github.com/ana");
  await page.getByRole("button", { name: "Adicionar link" }).click();
  await expect(page.getByText("https://github.com/ana")).toBeVisible();
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  const saved = await storedProfile(page);
  expect(saved?.headline).toBe("Dev Full Stack");
  expect((saved?.contact as { links: string[] }).links).toEqual(["https://github.com/ana"]);
});

test("formação é editável: adicionar, salvar e continuar lá depois do reload (RF-14)", async ({ page }) => {
  await page.goto("/perfil");
  await page.getByRole("button", { name: "Preencher manualmente" }).click();
  await page.getByRole("button", { name: "+ Formação" }).click();
  await page.getByLabel("Instituição", { exact: true }).fill("Universidade Exemplo");
  await page.getByLabel("Curso ou grau").fill("Bacharelado em Sistemas de Informação");
  await page.getByLabel(/^Ano de início/).fill("2014");
  await page.getByLabel(/^Ano de conclusão/).fill("2018");
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Perfil salvo" })).toBeVisible();

  await page.reload();
  await expect(page.locator("strong", { hasText: "Bacharelado em Sistemas de Informação · Universidade Exemplo" })).toBeVisible();
  await expect(page.getByText("2014 – 2018")).toBeVisible();
  const saved = await storedProfile(page);
  expect(saved?.education).toEqual([
    {
      institution: "Universidade Exemplo",
      degree: "Bacharelado em Sistemas de Informação",
      startYear: "2014",
      endYear: "2018",
    },
  ]);

  await page.getByRole("button", { name: /^Remover formação/ }).click();
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: /^Editar formação/ })).toHaveCount(0);
});

test("avisa antes de sair do perfil com alterações não salvas", async ({ page }) => {
  await page.goto("/perfil");
  await page.getByRole("button", { name: "Preencher manualmente" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Ana Alterada");
  const minhasVagas = page.getByRole("link", { name: "Minhas vagas" }).first();

  let mensagem = "";
  page.once("dialog", (d) => {
    mensagem = d.message();
    void d.dismiss();
  });
  await minhasVagas.click();
  expect(mensagem).toBe("Você tem alterações não salvas no perfil. Sair mesmo assim?");
  await expect(page).toHaveURL(/\/perfil$/);

  page.once("dialog", (d) => void d.accept());
  await minhasVagas.click();
  await expect(page).toHaveURL(/\/minhas-vagas$/);
});

test("depois de salvar o perfil, sair não mostra aviso", async ({ page }) => {
  await page.goto("/perfil");
  await page.getByRole("button", { name: "Preencher manualmente" }).click();
  await page.getByLabel("Nome", { exact: true }).fill("Ana Salva");
  await page.getByRole("button", { name: "Salvar perfil" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Perfil salvo" })).toBeVisible();

  page.on("dialog", (d) => {
    void d.dismiss();
    throw new Error("diálogo inesperado");
  });
  await page.getByRole("link", { name: "Minhas vagas" }).first().click();
  await expect(page).toHaveURL(/\/minhas-vagas$/);
});
