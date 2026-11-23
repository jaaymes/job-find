import { expect, test, type Page, type Route } from "@playwright/test";

const STORE_KEY = "jobfind:v1:ai";
const OPENAI_KEY = "sk-test-openai-abcd1234";

type Stored = {
  providers: Record<string, { key?: string; baseURL?: string; addedAt: string; source: "pkce" | "paste"; privacyAccepted?: boolean }>;
  tasks: Record<"extract" | "analyze" | "cv", { provider: string; model: string } | null>;
};

function corsHeaders(route: Route): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": route.request().headers()["access-control-request-headers"] ?? "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };
}

/** Responde JSON com CORS; o preflight (OPTIONS) recebe 204. */
async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  if (route.request().method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers: corsHeaders(route) });
    return;
  }
  await route.fulfill({ status, headers: corsHeaders(route), contentType: "application/json", body: JSON.stringify(body) });
}

let openaiStatus = 200;
const requestedHosts: string[] = [];

async function mockProviders(page: Page): Promise<void> {
  // Rota mais genérica primeiro (as registradas depois têm precedência): qualquer host externo não mockado falha rápido.
  await page.route(
    (url) => url.hostname !== "localhost",
    (route) => fulfillJson(route, 503, { error: "não mockado" }),
  );
  await page.route("https://api.openai.com/v1/models*", (route) => {
    requestedHosts.push("api.openai.com");
    return openaiStatus === 200
      ? fulfillJson(route, 200, { data: [{ id: "gpt-5-mini" }, { id: "gpt-5" }, { id: "gpt-5-nano" }] })
      : fulfillJson(route, openaiStatus, { error: { message: "Incorrect API key" } });
  });
  await page.route("https://openrouter.ai/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/keys")) return fulfillJson(route, 200, { key: "sk-or-v1-pkce9999" });
    if (path.endsWith("/key")) return fulfillJson(route, 200, { data: { label: "ok" } });
    return fulfillJson(route, 200, {
      data: [
        { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", pricing: { prompt: "0.0000005", completion: "0.000002" } },
        { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", pricing: { prompt: "0.0000001", completion: "0.0000004" } },
        { id: "acme/modelo-gratis:free", name: "Modelo grátis", pricing: { prompt: "0", completion: "0" } },
      ],
    });
  });
}

async function seed(page: Page, data: Partial<Stored> & { providers: Stored["providers"] }): Promise<void> {
  const payload = {
    v: 1,
    data: {
      tasks: { extract: null, analyze: null, cv: null },
      dataCollectionDeny: true,
      minimizePii: true,
      ...data,
    },
  };
  // Só semeia se ainda não houver dados: o reload do teste de persistência não pode sobrescrever.
  await page.addInitScript(
    ([k, v]) => {
      if (!window.localStorage.getItem(k)) window.localStorage.setItem(k, v);
    },
    [STORE_KEY, JSON.stringify(payload)],
  );
}

const added = "2026-11-20T00:00:00.000Z";
const openaiProvider = { key: OPENAI_KEY, addedAt: added, source: "paste" as const };
const openrouterProvider = { key: "sk-or-v1-seed4321", addedAt: added, source: "pkce" as const };

const stored = (page: Page): Promise<Stored | null> =>
  page.evaluate((k) => {
    const raw = window.localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as { data: Stored }).data : null;
  }, STORE_KEY);

const card = (page: Page, name: string) => page.getByRole("article", { name, exact: true });

test.beforeEach(async ({ page }) => {
  openaiStatus = 200;
  requestedHosts.length = 0;
  await mockProviders(page);
});

test.describe("Configurações de IA", () => {
  test("colar a chave da OpenAI e testar a conexão: Conectado, e Chave inválida com 401", async ({ page }) => {
    await page.goto("/configuracoes");
    await expect(page.getByRole("heading", { name: "Configurações de IA", level: 1 })).toBeVisible();
    const openai = card(page, "OpenAI");
    await expect(openai.getByText("Não conectado")).toBeVisible();
    await openai.getByRole("button", { name: "Adicionar chave" }).click();

    const dialog = page.getByRole("dialog", { name: /Adicionar chave/ });
    const input = dialog.getByLabel("Chave de API");
    await expect(input).toHaveAttribute("type", "password");
    await input.fill(OPENAI_KEY);
    await dialog.getByRole("button", { name: "Mostrar chave" }).click();
    await expect(input).toHaveAttribute("type", "text");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(dialog).toBeHidden();

    // A chave completa nunca aparece na tela; só os 4 últimos caracteres.
    await expect(openai.getByText("Conectado", { exact: true })).toBeVisible();
    await expect(openai.getByText("1234")).toBeVisible();
    await expect(page.getByText(OPENAI_KEY)).toHaveCount(0);
    expect((await stored(page))?.providers.openai?.key).toBe(OPENAI_KEY);

    await openai.getByRole("button", { name: "Testar conexão" }).click();
    await expect(openai.getByRole("status")).toHaveText("Conectado");

    openaiStatus = 401;
    await openai.getByRole("button", { name: "Testar conexão" }).click();
    await expect(openai.getByRole("status")).toHaveText("Chave inválida");
  });

  test("OpenRouter: Conectar vai para openrouter.ai/auth e o retorno do callback deixa o provedor conectado", async ({ page }) => {
    await page.route("https://openrouter.ai/auth*", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>OpenRouter</title><p>login simulado</p>" }),
    );
    await page.goto("/configuracoes");
    const authRequest = page.waitForRequest((r) => r.url().startsWith("https://openrouter.ai/auth"));
    await card(page, "OpenRouter").getByRole("button", { name: "Conectar" }).click();
    const url = new URL((await authRequest).url());
    expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
    expect(url.searchParams.get("callback_url")).toMatch(/\/configuracoes\/callback$/);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();

    // Retorno do provedor na mesma aba (o verifier está no sessionStorage).
    await page.goto("/configuracoes/callback?code=x");
    await page.waitForURL("**/configuracoes");
    const openrouter = card(page, "OpenRouter");
    await expect(openrouter.getByText("Conectado", { exact: true })).toBeVisible();
    await expect(openrouter.getByText("9999")).toBeVisible();
    expect((await stored(page))?.providers.openrouter?.source).toBe("pkce");
  });

  test("modelo por tarefa: provedor e modelo de Gerar CV e carta persistem após recarregar", async ({ page }) => {
    await seed(page, { providers: { openai: openaiProvider, openrouter: openrouterProvider } });
    await page.goto("/configuracoes");
    const row = page.getByRole("group", { name: "Gerar CV e carta" });
    await row.getByLabel("Provedor").selectOption("openrouter");
    const model = row.getByLabel("Modelo");
    await expect(model.locator("option[value='deepseek/deepseek-v4.1-flash']")).toHaveCount(1);
    await model.selectOption("deepseek/deepseek-v4.1-flash");
    // Custo estimado a partir dos preços do listModels.
    await expect(row.getByText(/≈ US\$ [\d,]+ por CV/)).toBeVisible();

    await expect.poll(async () => (await stored(page))?.tasks.cv).toEqual({
      provider: "openrouter",
      model: "deepseek/deepseek-v4.1-flash",
    });
    await page.reload();
    const again = page.getByRole("group", { name: "Gerar CV e carta" });
    await expect(again.getByLabel("Provedor")).toHaveValue("openrouter");
    await expect(again.getByLabel("Modelo")).toHaveValue("deepseek/deepseek-v4.1-flash");
    // As outras tarefas continuam no padrão automático.
    await expect(page.getByRole("group", { name: "Analisar vaga" }).getByLabel("Provedor")).toHaveValue("");
  });

  test("modelo gratuito (:free) do OpenRouter mostra um aviso", async ({ page }) => {
    await seed(page, { providers: { openrouter: openrouterProvider } });
    await page.goto("/configuracoes");
    const row = page.getByRole("group", { name: "Analisar vaga" });
    await row.getByLabel("Provedor").selectOption("openrouter");
    await row.getByLabel("Modelo").selectOption("acme/modelo-gratis:free");
    await expect(row.getByText(/modelos gratuitos/i)).toBeVisible();
  });

  test("Gemini abre o aviso de privacidade; confirmar libera o campo da chave e grava o aceite", async ({ page }) => {
    await page.goto("/configuracoes");
    const gemini = card(page, "Google Gemini");
    await gemini.getByRole("button", { name: "Adicionar chave" }).click();
    const privacy = page.getByRole("dialog", { name: /Aviso de privacidade/ });
    await expect(privacy).toContainText("pode usar os dados enviados");
    await privacy.getByRole("button", { name: "Entendi e aceito" }).click();

    const dialog = page.getByRole("dialog", { name: /Adicionar chave/ });
    await dialog.getByLabel("Chave de API").fill("AIza-teste-0000");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await expect(dialog).toBeHidden();
    const data = await stored(page);
    expect(data?.providers.google?.privacyAccepted).toBe(true);
    expect(data?.providers.google?.key).toBe("AIza-teste-0000");
  });

  test("cancelar o aviso de privacidade deixa o Gemini desconectado", async ({ page }) => {
    await page.goto("/configuracoes");
    const gemini = card(page, "Google Gemini");
    await gemini.getByRole("button", { name: "Adicionar chave" }).click();
    const privacy = page.getByRole("dialog", { name: /Aviso de privacidade/ });
    await privacy.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(gemini.getByText("Não conectado")).toBeVisible();
    expect((await stored(page))?.providers.google).toBeUndefined();
  });

  test("Remover chave apaga a chave do localStorage", async ({ page }) => {
    await seed(page, { providers: { openai: openaiProvider } });
    await page.goto("/configuracoes");
    const openai = card(page, "OpenAI");
    await expect(openai.getByText("Conectado", { exact: true })).toBeVisible();
    await openai.getByRole("button", { name: "Remover chave" }).click();
    await expect(openai.getByText("Não conectado")).toBeVisible();
    const data = await stored(page);
    expect(data?.providers.openai).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain(OPENAI_KEY);
  });

  test("a IA local mostra o guia experimental com a origem desta página", async ({ page }) => {
    await page.goto("/configuracoes");
    await page.getByRole("article", { name: /IA local/ }).getByRole("button", { name: "Ver guia" }).click();
    const guide = page.getByRole("region", { name: "Guia da IA local" });
    await expect(guide).toContainText("experimental");
    await expect(guide).toContainText("OLLAMA_ORIGINS=http://localhost:3100");
    await expect(guide).toContainText("127.0.0.1");
  });

  test("/configuracoes hidrata sem violações de CSP", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => {
      if (/content security policy|refused to (load|apply|execute|connect)/i.test(m.text())) problems.push(m.text());
    });
    await page.addInitScript(() => {
      (window as unknown as { __v: string[] }).__v = [];
      document.addEventListener("securitypolicyviolation", (e) =>
        (window as unknown as { __v: string[] }).__v.push(`${e.violatedDirective} ${e.blockedURI}`),
      );
    });
    await page.goto("/configuracoes");
    await expect(page.getByRole("heading", { name: "Provedores" })).toBeVisible();
    await card(page, "OpenAI").getByRole("button", { name: "Adicionar chave" }).click();
    expect(await page.evaluate(() => (window as unknown as { __v: string[] }).__v)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("o backup aparece desabilitado com o texto em breve", async ({ page }) => {
    await page.goto("/configuracoes");
    await expect(page.getByRole("button", { name: /Exportar dados/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /Importar backup/ })).toBeDisabled();
    await expect(page.getByText("em breve").first()).toBeVisible();
  });

  test("Perfil sem provedor conectado mostra o CTA para Configurações", async ({ page }) => {
    await page.goto("/perfil");
    const cta = page.getByRole("link", { name: "Conecte uma IA em Configurações" });
    await expect(cta).toHaveAttribute("href", "/configuracoes");
    await cta.click();
    await expect(page).toHaveURL(/\/configuracoes$/);
    await expect(page.getByRole("link", { name: "Configurações", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("Perfil com provedor conectado não mostra o CTA", async ({ page }) => {
    await seed(page, { providers: { openai: openaiProvider } });
    await page.goto("/perfil");
    await expect(page.getByRole("heading", { name: "Perfil — em construção" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Conecte uma IA em Configurações" })).toHaveCount(0);
  });
});
