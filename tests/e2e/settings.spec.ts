import { readFile } from "node:fs/promises";
import { expect, test, type Page, type Route } from "@playwright/test";

const STORE_KEY = "jobfind:v1:ai";
const OPENAI_KEY = "sk-test-openai-abcd1234";

/** `source: "pkce"` é legado (antes do OAuth genérico); o app lê como "oauth". */
type Stored = {
  providers: Record<string, { key?: string; baseURL?: string; addedAt: string; source: "oauth" | "paste" | "pkce"; privacyAccepted?: boolean; freeConsent?: boolean }>;
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
const openrouterProvider = { key: "sk-or-v1-seed4321", addedAt: added, source: "oauth" as const };

const stored = (page: Page): Promise<Stored | null> =>
  page.evaluate((k) => {
    const raw = window.localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as { data: Stored }).data : null;
  }, STORE_KEY);

const card = (page: Page, name: string) => page.getByRole("article", { name, exact: true });
/** Linha compacta do provedor na lista "Provedores conectados" (só existe depois de conectar). */
const connectedRow = (page: Page, name: string) =>
  page.getByRole("list", { name: "Provedores conectados" }).getByRole("article", { name, exact: true });

const pendingOAuth = (page: Page): Promise<string | null> =>
  page.evaluate(() => window.sessionStorage.getItem("jobfind:oauth:pending"));

/** Abre o login do OpenRouter (aceitando o aviso dos gratuitos) e devolve o `state` que vai na `callback_url`. */
async function startOpenRouterLogin(page: Page): Promise<string> {
  await page.route("https://openrouter.ai/auth*", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>OpenRouter</title><p>login simulado</p>" }),
  );
  await page.goto("/configuracoes");
  const authRequest = page.waitForRequest((r) => r.url().startsWith("https://openrouter.ai/auth"));
  await card(page, "OpenRouter").getByRole("button", { name: "Conectar com OpenRouter" }).click();
  // Antes do login, o aviso dos modelos gratuitos (padrão do OpenRouter).
  const notice = page.getByRole("dialog", { name: /Aviso dos modelos gratuitos/ });
  await expect(notice).toContainText("limite de uso por dia");
  await notice.getByRole("button", { name: "Entendi e aceito" }).click();
  const url = new URL((await authRequest).url());
  expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")).toBeTruthy();
  const callback = new URL(url.searchParams.get("callback_url")!);
  expect(callback.pathname).toBe("/configuracoes/callback");
  const state = callback.searchParams.get("state");
  expect(state).toBeTruthy();
  return state!;
}

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
    await dialog.getByRole("button", { name: "Testar e salvar" }).click();
    await expect(dialog).toBeHidden();

    // Conectado: sai da grade e vira uma linha da lista "Provedores conectados".
    // A chave completa nunca aparece na tela; só os 4 últimos caracteres.
    await expect(connectedRow(page, "OpenAI")).toBeVisible();
    await expect(openai.getByText("Chave colada", { exact: true })).toBeVisible();
    await expect(openai.getByText("· termina em 1234")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "1 provedor conectado" })).toBeVisible();
    await expect(page.getByText(OPENAI_KEY)).toHaveCount(0);
    expect((await stored(page))?.providers.openai?.key).toBe(OPENAI_KEY);

    await openai.getByRole("button", { name: "Testar conexão" }).click();
    await expect(openai.getByRole("status")).toHaveText("Conectado");

    openaiStatus = 401;
    await openai.getByRole("button", { name: "Testar conexão" }).click();
    await expect(openai.getByRole("status")).toHaveText("Chave inválida. Confira a chave em Configurações.");

    openaiStatus = 402;
    await openai.getByRole("button", { name: "Testar conexão" }).click();
    await expect(openai.getByRole("status")).toHaveText("Sem crédito, recarregue");
  });

  test("OpenRouter: Conectar vai para openrouter.ai/auth e o retorno do callback deixa o provedor conectado", async ({ page }) => {
    const state = await startOpenRouterLogin(page);

    // Retorno do provedor na mesma aba (o pending está no sessionStorage); o state volta na query.
    await page.goto(`/configuracoes/callback?code=x&state=${encodeURIComponent(state)}`);
    await page.waitForURL("**/configuracoes");
    const openrouter = connectedRow(page, "OpenRouter");
    await expect(openrouter).toBeVisible();
    await expect(openrouter.getByText("· termina em 9999")).toBeVisible();
    await expect(openrouter.getByText("Conectado com OAuth", { exact: true })).toBeVisible();
    expect((await stored(page))?.providers.openrouter?.source).toBe("oauth");
    expect((await stored(page))?.providers.openrouter?.freeConsent).toBe(true);
  });

  test("OpenRouter: callback com state diferente mostra o erro e não salva nada", async ({ page }) => {
    let exchanged = false;
    await page.route("https://openrouter.ai/api/v1/auth/keys", (route) => {
      exchanged = true;
      return fulfillJson(route, 200, { key: "sk-or-v1-nao-devia" });
    });
    await startOpenRouterLogin(page);
    // O título usa o provedor do pending: ler o sessionStorage na renderização divergiria do HTML do servidor.
    // Em produção o React reporta a divergência como erro de página (#418), não no console.
    const hydration: string[] = [];
    page.on("pageerror", (e) => {
      if (/hydrat|#418|#423|#425/i.test(e.message)) hydration.push(e.message);
    });
    await page.goto("/configuracoes/callback?code=x&state=errado");
    // O Next tem o próprio route announcer com role=alert; o da página fica no <main>.
    const alert = page.getByRole("main").getByRole("alert");
    await expect(alert).toContainText("Falha ao conectar");
    await expect(alert).toContainText("O retorno do login não confere com esta sessão. Conecte de novo nas configurações.");
    // code e state saem da URL.
    expect(new URL(page.url()).search).toBe("");
    expect(exchanged).toBe(false);
    expect((await stored(page))?.providers.openrouter).toBeUndefined();
    await expect.poll(() => pendingOAuth(page)).toBeNull();
    await expect(page.getByRole("heading", { name: "Falha ao conectar o OpenRouter" })).toBeVisible();
    expect(hydration).toEqual([]);
  });

  test("OpenRouter: retorno com a query concatenada (?state=…?code=…) ainda conecta", async ({ page }) => {
    const state = await startOpenRouterLogin(page);
    await page.goto(`/configuracoes/callback?state=${encodeURIComponent(state)}?code=x`);
    await page.waitForURL("**/configuracoes");
    await expect(connectedRow(page, "OpenRouter").getByText("· termina em 9999")).toBeVisible();
    expect((await stored(page))?.providers.openrouter?.source).toBe("oauth");
  });

  test("OpenRouter: voltar sem code (login cancelado) mostra o aviso e descarta o login pendente", async ({ page }) => {
    // Aqui a página está em openrouter.ai (outra origem), então o pending só é lido de volta no callback.
    await startOpenRouterLogin(page);
    await page.goto("/configuracoes/callback?error=access_denied");
    const alert = page.getByRole("main").getByRole("alert");
    await expect(alert).toContainText("Login cancelado ou não concluído. Conecte de novo nas configurações.");
    // O texto já vem no HTML do servidor; o pending é apagado no efeito, depois da hidratação.
    await expect.poll(() => pendingOAuth(page)).toBeNull();
    expect((await stored(page))?.providers.openrouter).toBeUndefined();
  });

  test("OpenRouter: callback com code sem sessão pendente pede para abrir o fluxo de novo", async ({ page }) => {
    await page.goto("/configuracoes/callback?code=x&state=qualquer");
    // O Next tem o próprio route announcer com role=alert; o da página fica no <main>.
    const alert = page.getByRole("main").getByRole("alert");
    await expect(alert).toContainText("Falha ao conectar o provedor");
    await expect(alert).toContainText(/abra o fluxo de novo na mesma aba/i);
    expect((await stored(page))?.providers.openrouter).toBeUndefined();
  });

  test("OpenRouter: cancelar o aviso dos gratuitos não abre o login", async ({ page }) => {
    let authOpened = false;
    await page.route("https://openrouter.ai/auth*", (route) => {
      authOpened = true;
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><p>login</p>" });
    });
    await page.goto("/configuracoes");
    await card(page, "OpenRouter").getByRole("button", { name: "Conectar com OpenRouter" }).click();
    const notice = page.getByRole("dialog", { name: /Aviso dos modelos gratuitos/ });
    await notice.getByRole("button", { name: "Cancelar" }).click();
    await expect(notice).toBeHidden();
    expect(authOpened).toBe(false);
  });

  test("OpenRouter conectado sem o aviso dos gratuitos oferece revisá-lo e grava o aceite", async ({ page }) => {
    // Registro legado (`source: "pkce"`): continua lido como login do OpenRouter.
    await seed(page, { providers: { openrouter: { ...openrouterProvider, source: "pkce" } } });
    await page.goto("/configuracoes");
    const openrouter = connectedRow(page, "OpenRouter");
    await expect(openrouter.getByText("Conectado com OAuth", { exact: true })).toBeVisible();
    await openrouter.getByRole("button", { name: "Revisar aviso dos modelos gratuitos" }).click();
    await page.getByRole("dialog", { name: /Aviso dos modelos gratuitos/ }).getByRole("button", { name: "Entendi e aceito" }).click();
    await expect.poll(async () => (await stored(page))?.providers.openrouter?.freeConsent).toBe(true);
    await expect(openrouter.getByRole("button", { name: "Revisar aviso dos modelos gratuitos" })).toBeHidden();
  });

  test("modelo por tarefa: o modelo escolhido no modal para Gerar CV e carta persiste após recarregar", async ({ page }) => {
    await seed(page, { providers: { openai: openaiProvider, openrouter: openrouterProvider } });
    await page.goto("/configuracoes");
    const row = page.getByRole("group", { name: "Gerar CV e carta" });
    await expect(row.getByText("Automático", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Trocar modelo" }).click();

    // O modal fica em portal, fora do grupo.
    const dialog = page.getByRole("dialog", { name: "Modelo para Gerar CV e carta" });
    const search = dialog.getByLabel("Buscar modelo");
    await expect(search).toBeFocused();
    // Lista dos dois provedores conectados; a busca filtra (o "Automático" do topo continua).
    await expect(dialog.getByRole("option", { name: /DeepSeek V4\.1 Flash/ })).toBeVisible();
    await expect(dialog.getByRole("option", { name: /gpt-5-mini/ })).toBeVisible();
    await search.fill("v4.1");
    const options = dialog.getByRole("option");
    await expect(options).toHaveCount(2);
    await expect(options.first()).toContainText("Automático");
    await dialog.getByRole("option", { name: /DeepSeek V4\.1 Flash/ }).click();
    await expect(dialog).toBeHidden();

    // Resumo da linha com o nome do modelo, o provedor e o custo estimado a partir dos preços do listModels.
    await expect(row.getByText("DeepSeek V4.1 Flash · OpenRouter", { exact: true })).toBeVisible();
    await expect(row.getByText(/≈ US\$ [\d,]+ por CV/)).toBeVisible();
    await expect.poll(async () => (await stored(page))?.tasks.cv).toEqual({
      provider: "openrouter",
      model: "deepseek/deepseek-v4.1-flash",
    });

    await page.reload();
    const again = page.getByRole("group", { name: "Gerar CV e carta" });
    // Após recarregar, a linha só lê o cache (vazio até abrir o modal): mostra o id salvo, sem custo.
    await expect(again.getByText("deepseek/deepseek-v4.1-flash · OpenRouter", { exact: true })).toBeVisible();
    await again.getByRole("button", { name: "Trocar modelo" }).click();
    const reopened = page.getByRole("dialog", { name: "Modelo para Gerar CV e carta" });
    await expect(reopened.getByRole("option", { name: /DeepSeek V4\.1 Flash/ })).toContainText("Atual");
    await reopened.getByRole("button", { name: "Cancelar" }).click();
    await expect(reopened).toBeHidden();
    await expect(again.getByText("DeepSeek V4.1 Flash · OpenRouter", { exact: true })).toBeVisible();
    // As outras tarefas continuam no padrão automático.
    await expect(page.getByRole("group", { name: "Analisar vaga" }).getByText("Automático", { exact: true })).toBeVisible();
    expect((await stored(page))?.tasks.analyze).toBeNull();
  });

  test("modelo gratuito (:free) do OpenRouter mostra um aviso", async ({ page }) => {
    await seed(page, { providers: { openrouter: openrouterProvider } });
    await page.goto("/configuracoes");
    const row = page.getByRole("group", { name: "Analisar vaga" });
    await expect(row.getByRole("note")).toHaveCount(0);
    await row.getByRole("button", { name: "Trocar modelo" }).click();
    const dialog = page.getByRole("dialog", { name: "Modelo para Analisar vaga" });
    const free = dialog.getByRole("option", { name: /Modelo grátis/ });
    await expect(free).toContainText("Grátis");
    await free.click();
    await expect(dialog).toBeHidden();
    await expect(row.getByRole("note")).toContainText(/modelos gratuitos/i);
    await expect.poll(async () => (await stored(page))?.tasks.analyze).toEqual({
      provider: "openrouter",
      model: "acme/modelo-gratis:free",
    });
  });

  test("o modal lista do mais barato ao mais caro e o modelo sem preço no fim, sem texto de preço", async ({ page }) => {
    // Registrada depois do mockProviders: tem precedência sobre a rota genérica do OpenRouter.
    await page.route("**/api/v1/models?**", (route) =>
      fulfillJson(route, 200, {
        data: [
          { id: "acme/caro", name: "Modelo Caro", pricing: { prompt: "0.00001", completion: "0.00003" } },
          { id: "acme/misterioso", name: "Modelo Misterioso" },
          { id: "acme/barato", name: "Modelo Barato", pricing: { prompt: "0.0000001", completion: "0.0000002" } },
          { id: "openrouter/free", name: "Free Models Router", pricing: { prompt: "0", completion: "0" } },
          { id: "acme/medio", name: "Modelo Médio", pricing: { prompt: "0.000001", completion: "0.000002" } },
        ],
      }),
    );
    await seed(page, { providers: { openrouter: openrouterProvider } });
    await page.goto("/configuracoes");
    await page.getByRole("group", { name: "Ler currículo" }).getByRole("button", { name: "Trocar modelo" }).click();
    const dialog = page.getByRole("dialog", { name: "Modelo para Ler currículo" });
    const options = dialog.getByRole("option");
    await expect(options).toHaveText([
      /^Automático/,
      /Free Models Router/,
      /Modelo Barato/,
      /Modelo Médio/,
      /Modelo Caro/,
      /Modelo Misterioso/,
    ]);
    await expect(options.nth(1)).toContainText("grátis");
    for (const i of [2, 3, 4]) await expect(options.nth(i)).toContainText(/≈ US\$ [\d,]+ por currículo/);
    const last = options.nth(5);
    await expect(last).not.toContainText("US$");
    await expect(last).not.toContainText(/grátis/i);
    await expect(last).not.toContainText(/sem preço/i);
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
    await dialog.getByRole("button", { name: "Testar e salvar" }).click();
    await expect(dialog).toBeHidden();
    const data = await stored(page);
    expect(data?.providers.google?.privacyAccepted).toBe(true);
    expect(data?.providers.google?.key).toBe("AIza-teste-0000");
    // O teste da chave falhou por rede (host não mockado): a chave fica salva com o aviso.
    await expect(page.getByText("Chave salva, mas não deu para testar agora.")).toBeVisible();
  });

  test("colar uma chave da Anthropic no card da OpenAI avisa sem bloquear o botão", async ({ page }) => {
    await page.goto("/configuracoes");
    await card(page, "OpenAI").getByRole("button", { name: "Adicionar chave" }).click();
    const dialog = page.getByRole("dialog", { name: /Adicionar chave/ });
    await dialog.getByLabel("Chave de API").fill("sk-ant-x");
    await expect(dialog.getByText("Parece uma chave do(a) Anthropic (Claude)")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Testar e salvar" })).toBeEnabled();
  });

  test("chave recusada pelo provedor (401) mantém o diálogo aberto e não salva", async ({ page }) => {
    openaiStatus = 401;
    await page.goto("/configuracoes");
    await card(page, "OpenAI").getByRole("button", { name: "Adicionar chave" }).click();
    const dialog = page.getByRole("dialog", { name: /Adicionar chave/ });
    const input = dialog.getByLabel("Chave de API");
    await input.fill(OPENAI_KEY);
    await dialog.getByRole("button", { name: "Testar e salvar" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("O provedor recusou essa chave.");
    await expect(input).toBeFocused();
    await expect(dialog).toBeVisible();
    expect((await stored(page))?.providers.openai).toBeUndefined();
    await expect(page.getByText(OPENAI_KEY)).toHaveCount(0);
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
    await expect(connectedRow(page, "OpenAI")).toBeVisible();
    await openai.getByRole("button", { name: "Remover chave" }).click();
    await expect(openai.getByText("Não conectado")).toBeVisible();
    await expect(page.getByRole("list", { name: "Provedores conectados" })).toHaveCount(0);
    // A linha removida (e o botão focado) some e a seção sobe: o foco vai para o título "Provedores".
    await expect(page.getByRole("heading", { name: "Provedores", level: 2, exact: true })).toBeFocused();
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

  test("/configuracoes e o callback hidratam sem violações de CSP", async ({ page }) => {
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
    await page.goto("/configuracoes/callback");
    // Sem login pendente, o callback não sabe o provedor: título genérico.
    await expect(page.getByText("Falha ao conectar o provedor")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __v: string[] }).__v)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("exportar sem chaves, e importar com confirmação que mostra só os 4 últimos caracteres", async ({ page }) => {
    await seed(page, { providers: { openai: openaiProvider } });
    await page.goto("/configuracoes");
    await expect(page.getByText(/contém dados pessoais/)).toBeVisible();
    const includeKeys = page.getByRole("checkbox", { name: /Incluir chaves de IA/ });
    await expect(includeKeys).not.toBeChecked();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Exportar dados" }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^jobfind-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const exported = await readFile((await download.path()) as string, "utf8");
    expect(exported).not.toContain(OPENAI_KEY);

    const backup = {
      format: "jobfind-backup",
      v: 1,
      exportedAt: added,
      data: {
        "jobfind:v1:ai": {
          providers: { anthropic: { key: "sk-ant-api-wxyz7777", addedAt: added, source: "paste" } },
          tasks: { extract: null, analyze: null, cv: null },
          dataCollectionDeny: true,
        },
      },
    };
    await page.getByLabel("Selecionar arquivo JSON").setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    const dialog = page.getByRole("dialog", { name: "Importar backup" });
    await expect(dialog.getByText("Configurações de IA", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/terminada em 7777/)).toBeVisible();
    await expect(page.getByText("sk-ant-api-wxyz7777")).toHaveCount(0);

    await dialog.getByRole("button", { name: "Importar sem as chaves" }).click();
    expect((await stored(page))?.providers.openai?.key).toBe(OPENAI_KEY);

    await page.getByLabel("Selecionar arquivo JSON").setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await page.getByRole("dialog", { name: "Importar backup" }).getByRole("button", { name: "Importar com as chaves" }).click();
    await expect(page.getByText("Backup importado.")).toBeVisible();
    expect((await stored(page))?.providers.anthropic?.key).toBe("sk-ant-api-wxyz7777");
    expect((await stored(page))?.providers.openai).toBeUndefined();
  });

  test("arquivo inválido ou grande demais mostra erro e não altera nada", async ({ page }) => {
    await seed(page, { providers: { openai: openaiProvider } });
    await page.goto("/configuracoes");
    const before = await stored(page);
    await page.getByLabel("Selecionar arquivo JSON").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("{não") });
    await expect(page.getByRole("alert").filter({ hasText: "não é um backup válido" })).toBeVisible();
    await page.getByLabel("Selecionar arquivo JSON").setInputFiles({
      name: "grande.json",
      mimeType: "application/json",
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 32),
    });
    await expect(page.getByRole("alert").filter({ hasText: "mais de 5 MB" })).toBeVisible();
    expect(await stored(page)).toEqual(before);
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
    await expect(page.getByRole("heading", { name: "Seu perfil" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Conecte uma IA em Configurações" })).toHaveCount(0);
  });
});
