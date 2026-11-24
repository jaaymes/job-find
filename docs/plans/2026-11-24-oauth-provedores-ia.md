# Integração de provedores de IA com OAuth — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o PKCE exclusivo do OpenRouter por um módulo OAuth genérico dirigido pelo registro, adicionar login OAuth do Hugging Face (CIMD, sem cadastro) e deixar o "colar chave" dos demais provedores mais fácil.

**Architecture:** `ProviderDef.auth` vira união discriminada (`oauth` | `paste` | `none`); cada provedor OAuth traz um `OAuthFlow` (authorizeUrl/exchange/refresh). `lib/client/ai/oauth.ts` faz PKCE + `state` + fluxo pendente no `sessionStorage`; o callback único `/configuracoes/callback` descobre o provedor pelo fluxo pendente. O HF usa como `client_id` a URL da rota `/.well-known/oauth-cimd` do próprio deploy.

**Tech Stack:** Next 16 (App Router), React 19, AI SDK 7, Zod 4, Vitest, Playwright.

**Spec:** [docs/tech/2026-11-24-oauth-provedores-ia.md](../tech/2026-11-24-oauth-provedores-ia.md)

## Global Constraints

- Tudo no navegador: nenhum `client_secret`, nenhuma chamada de IA ou troca de token pelo nosso servidor (RNF-01). Única rota nova no servidor: o JSON estático do CIMD.
- Sem variáveis de ambiente nem feature flags novas (RNF-02). Tudo já entra ativo.
- Token, refresh token, `code` e verifier nunca em URL, log, `AiError.meta` nem backup (RNF-04).
- Escopos do HF: exatamente `openid inference-api`.
- `redirect_uri` de todos os provedores: `${origin}/configuracoes/callback`.
- OpenRouter mantém `limit=5`, `expiration=1-year` e o aviso dos modelos gratuitos (`freeConsent`).
- Textos de UI em pt-BR, com acentuação correta.
- `AI_CSP_HOSTS` tem que continuar igual à união dos `cspHosts` (teste existente em `tests/unit/client/ai/providers.test.ts:47`).
- Verificação de cada task: `pnpm typecheck && pnpm lint && pnpm test`; tasks que mexem em rota ou callback também `pnpm build` e o E2E citado.
- Branch: começar de `main` num branch novo (`feat/oauth-provedores`), **depois** que o trabalho não commitado de `feat/modal-progresso-importacao` estiver resolvido. Commits só com autorização do usuário.

## Review Focus

1. Usuário abre o login em uma aba e volta pelo callback em outra (sem fluxo pendente) → mensagem "abra o fluxo de novo na mesma aba", nada salvo. Teste na Task 3.
2. Callback com `state` diferente do guardado (CSRF / link antigo) → não chama o token endpoint, mostra erro, limpa o fluxo pendente. Teste na Task 2.
3. Duas gerações em paralelo com token do HF perto de expirar → um único `refresh`, as duas usam o token novo. Teste na Task 6.
4. Settings antigos com `source: "pkce"` → continuam válidos e aparecem como conectados pelo login. Teste na Task 3.
5. Chave de outro provedor colada no card errado (ex.: `sk-ant-…` no OpenAI) → aviso sugerindo o card da Anthropic, sem bloquear o salvar. Teste na Task 7.

---

## Fase 0 — Spike (manual, sem código no repositório)

### Task 0: Confirmar premissas no Hugging Face real

- [ ] **Step 1:** Num preview da Vercel, servir à mão (rota temporária ou deploy de teste) o JSON do CIMD da Task 4 e abrir `https://huggingface.co/oauth/authorize?client_id=<preview>/.well-known/oauth-cimd&redirect_uri=<preview>/configuracoes/callback&response_type=code&scope=openid%20inference-api&code_challenge=…&code_challenge_method=S256&state=x`.
- [ ] **Step 2:** No console do navegador do preview, fazer o `POST https://huggingface.co/oauth/token` (form-urlencoded: `grant_type=authorization_code`, `code`, `code_verifier`, `redirect_uri`, `client_id`). Registrar: CORS ok?, campos devolvidos (`access_token`, `refresh_token`, `expires_in`), se o refresh token rotaciona.
- [ ] **Step 3:** Chamar `POST https://router.huggingface.co/v1/chat/completions` com o token e um modelo pequeno; e `grant_type=refresh_token`.
- [ ] **Step 4:** Confirmar o prefixo de chave e a URL da página "criar chave" de cada provedor `paste` (tabela da Task 7).
- [ ] **Step 5:** Registrar o resultado em `docs/tech/spikes.md`. **Se CIMD ou CORS falhar:** aplicar plano B (P-03): cadastrar OAuth app público no HF com os redirect URIs de prod e `localhost:3000`, e usar o client_id como constante `HF_CLIENT_ID` em `lib/client/ai/oauth/huggingface.ts` (a Task 4 deixa de existir).

---

## Fase 1 — Módulo OAuth genérico

### Task 1: `auth` como união discriminada no registro

**Files:**
- Modify: `lib/client/ai/providers.ts:30-49` (tipos), `:248-269` (`compat`), entradas de `PROVIDERS`
- Modify: `components/settings/ProviderCard.tsx`, `components/settings/AiSettingsScreen.tsx` (só leitura de `auth.kind`)
- Test: `tests/unit/client/ai/providers.test.ts`

**Interfaces:**
- Produces (em `providers.ts`):
  ```ts
  export type OAuthTokens = { key: string; refreshToken?: string; expiresAt?: string };
  export type OAuthFlow = {
    authorizeUrl(p: { redirectUri: string; challenge: string; state: string; origin: string }): string;
    exchange(p: { code: string; verifier: string; redirectUri: string; origin: string }): Promise<OAuthTokens>;
    refresh?(p: { refreshToken: string; origin: string }): Promise<OAuthTokens>;
  };
  export type AuthDef =
    | { kind: "oauth"; flow: OAuthFlow; pasteFallback?: boolean }
    | { kind: "paste" }
    | { kind: "none" };
  export type KeyHint = { prefix: string; example: string };
  // ProviderDef: `auth: AuthDef`, `keyHint?: KeyHint`, `keySteps?: string[]`
  ```
- Nesta task o OpenRouter recebe `auth: { kind: "oauth", flow: openRouterFlow }` com `openRouterFlow` provisório que delega a `pkce.ts` (substituído na Task 2). `local` → `{ kind: "none" }`, demais → `{ kind: "paste" }`.

- [ ] **Step 1: Teste que falha** em `providers.test.ts`:
  ```ts
  it("auth: só OpenRouter e Hugging Face usam oauth; local não tem auth", () => {
    const kinds = Object.fromEntries(PROVIDER_IDS.map((id) => [id, PROVIDERS[id].auth.kind]));
    expect(kinds.openrouter).toBe("oauth");
    expect(kinds.local).toBe("none");
    expect(PROVIDER_IDS.filter((id) => kinds[id] === "paste")).not.toContain("openrouter");
  });
  ```
  (O HF entra como `oauth` na Task 5; até lá a asserção é só sobre OpenRouter/local.)
- [ ] **Step 2:** `pnpm vitest run tests/unit/client/ai/providers.test.ts` → FAIL (`auth.kind` undefined).
- [ ] **Step 3:** Aplicar os tipos; trocar `def.auth === "pkce"` por `def.auth.kind === "oauth"` e `def.auth === "paste"` por `def.auth.kind === "paste"` em `ProviderCard.tsx:87-92,123,139` e onde mais aparecer (`grep -rn 'auth ===' components lib`).
- [ ] **Step 4:** `pnpm typecheck && pnpm test` → PASS.
- [ ] **Step 5: Commit** `refactor(ia): auth do provedor como união discriminada`.

### Task 2: `oauth.ts` genérico + adaptador OpenRouter

**Files:**
- Create: `lib/client/ai/oauth/index.ts` (núcleo), `lib/client/ai/oauth/openrouter.ts` (adaptador)
- Delete: `lib/client/ai/pkce.ts` (conteúdo migra)
- Rename/rewrite: `tests/unit/client/ai/pkce.test.ts` → `tests/unit/client/ai/oauth.test.ts`; Create `tests/unit/client/ai/oauth-openrouter.test.ts`
- Modify: `lib/client/ai/providers.ts` (OpenRouter usa `openRouterFlow` de `oauth/openrouter.ts`)

**Interfaces:**
- Consumes: `OAuthFlow`, `OAuthTokens`, `PROVIDERS` (Task 1).
- Produces (`oauth/index.ts`):
  ```ts
  export type OAuthIntent = { freeConsent?: boolean };
  export const PENDING_KEY = "jobfind:oauth:pending";
  export function callbackUrl(origin: string): string;            // `${origin}/configuracoes/callback`
  export async function startOAuth(id: ProviderId, origin: string, intent?: OAuthIntent): Promise<string>; // URL de autorização
  export function readPending(): { provider: ProviderId; intent: OAuthIntent } | null; // não consome
  export async function completeOAuth(p: { code: string; state: string | null; origin: string }):
    Promise<{ provider: ProviderId; tokens: OAuthTokens; intent: OAuthIntent }>;
  ```
  Pending guardado como JSON `{ provider, verifier, state, intent }`. `completeOAuth` sempre remove `PENDING_KEY` (sucesso ou erro). Erros: sem pending → `AiError("unavailable", { meta: { reason: "missing_verifier" } })`; `state` diferente → `AiError("unavailable", { meta: { reason: "state_mismatch" } })` **sem** chamar fetch.
- Produces (`oauth/openrouter.ts`): `export const openRouterFlow: OAuthFlow`. `authorizeUrl` coloca o `state` como query na `callback_url` (`…/configuracoes/callback?state=…`) porque o OpenRouter não documenta `state`; mantém `limit=5`, `expiration=1-year`, S256. `exchange` = POST JSON atual em `/api/v1/auth/keys`, devolve `{ key }`.

- [ ] **Step 1: Testes que falham** — migrar os casos de `pkce.test.ts` para `oauth.test.ts`/`oauth-openrouter.test.ts` e adicionar:
  ```ts
  it("startOAuth guarda pending com provider, verifier, state e intent; URL não contém o verifier", …
    expect(JSON.parse(sessionStorage.getItem(PENDING_KEY)!)).toMatchObject({ provider: "openrouter", intent: { freeConsent: true } });
  it("completeOAuth com state diferente lança state_mismatch, não chama fetch e limpa o pending", …
    expect(fetchMock).not.toHaveBeenCalled(); expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  it("completeOAuth sem pending lança missing_verifier", …
  it("erro de troca não carrega code, verifier nem chave em message/meta", …
    expect(JSON.stringify({ m: err.message, meta: err.meta })).not.toMatch(/c0de|verif|sk-or/);
  it("openRouterFlow.authorizeUrl: callback_url com ?state=, limit=5, expiration=1-year, S256", …
  ```
- [ ] **Step 2:** `pnpm vitest run tests/unit/client/ai/oauth*.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 3:** Implementar; base64url/verifier/digest movidos de `pkce.ts`. `state` = `base64url(crypto.getRandomValues(new Uint8Array(32)))`; comparação em tempo constante (loop XOR sobre os códigos dos caracteres, tamanho diferente → falso).
- [ ] **Step 4:** Rodar os testes → PASS. Apagar `pkce.ts` e `pkce.test.ts`; `pnpm typecheck` acusa os imports do callback/AiSettingsScreen — tratados na Task 3 (fazer Tasks 2 e 3 no mesmo branch antes de verificar o build).
- [ ] **Step 5: Commit** `feat(ia): módulo OAuth genérico com state e adaptador do OpenRouter`.

### Task 3: Settings, callback genérico e UI por `auth.kind`

**Files:**
- Modify: `lib/client/ai/settings.ts:24-35`
- Modify: `app/(local)/configuracoes/callback/page.tsx`
- Modify: `components/settings/AiSettingsScreen.tsx:107-120,129-137`, `components/settings/ProviderCard.tsx`
- Test: `tests/unit/client/ai/settings.test.ts` (criar se não existir), `tests/unit/client/provider-card.test.tsx` (criar), `tests/e2e/settings.spec.ts:130-153`

**Interfaces:**
- Consumes: `startOAuth`, `completeOAuth`, `readPending`, `callbackUrl` (Task 2).
- Produces:
  - Schema: `source: z.enum(["oauth", "paste"])` com `z.preprocess` que mapeia `"pkce"` → `"oauth"`; novos `refreshToken: z.string().optional()`, `expiresAt: z.string().optional()`.
  - `ProviderCard` props: `onConnectOAuth: () => void` (substitui `onConnectPkce`), `oauthError?: string | null` (substitui `pkceError`).
  - `AiSettingsScreen`: `connectOAuth(id: ProviderId)` — OpenRouter abre antes o aviso dos gratuitos (`then: "oauth"`), demais vão direto para `startOAuth(id, origin)`.

- [ ] **Step 1: Testes que falham:**
  ```ts
  // settings.test.ts
  it("aceita source legado 'pkce' e lê como 'oauth'", () => {
    const s = AiSettings.parse({ ...defaultAiSettings(), providers: { openrouter: { key: "k", addedAt: "2026-01-01T00:00:00Z", source: "pkce" } } });
    expect(s.providers.openrouter?.source).toBe("oauth");
  });
  // provider-card.test.tsx
  it("oauth mostra 'Conectar com OpenRouter'; paste mostra 'Adicionar chave'; conectado por oauth mostra 'Conectado pelo login do OpenRouter em'", …
  ```
  E2E: o teste existente (`settings.spec.ts:130`) passa a ler o `state` da `callback_url` capturada e ir para `/configuracoes/callback?code=x&state=<state>`; espera `source` `"oauth"`. Novo E2E: `/configuracoes/callback?code=x&state=errado` → alerta "Falha ao conectar", nada salvo. Novo E2E (Review Focus 1): callback com `code` sem pending (sessionStorage limpo) → texto "abra o fluxo de novo na mesma aba".
- [ ] **Step 2:** `pnpm test` → FAIL nos novos.
- [ ] **Step 3:** Callback: ler `code` e `state` na 1ª renderização, `replaceState`, `readPending()` para o título ("Conectando ao <label>…"), `completeOAuth`, gravar `providers[provider] = { ...prev, key, refreshToken, expiresAt, addedAt, source: "oauth", ...(intent.freeConsent ? { freeConsent: true } : {}) }`. Mensagens usam `PROVIDERS[provider].label`; sem pending, título genérico "Falha ao conectar o provedor". `state_mismatch` → "O retorno do login não confere com esta sessão. Conecte de novo nas configurações."
- [ ] **Step 4:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e tests/e2e/settings.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(ia): callback OAuth genérico e cards por tipo de autenticação`.

---

## Fase 2 — Hugging Face

### Task 4: Rota CIMD

**Files:**
- Create: `app/.well-known/oauth-cimd/route.ts`
- Test: `tests/unit/server/oauth-cimd.test.ts`

**Interfaces:**
- Produces: `GET /.well-known/oauth-cimd` → JSON
  ```json
  { "client_id": "<origin>/.well-known/oauth-cimd", "client_name": "Job Find",
    "redirect_uris": ["<origin>/configuracoes/callback"], "token_endpoint_auth_method": "none",
    "client_uri": "<origin>", "logo_uri": "<origin>/icon.svg" }
  ```
  e `export function cimdOrigin(req: Request): string | null` (mesmo arquivo ou `lib/server/cimd.ts`): usa `new URL(req.url).origin`; só aceita `https:` (ou `http://localhost:<porta>` para teste local). Origem inválida → 400. Header `Cache-Control: public, max-age=300`. `export const dynamic = "force-dynamic"` não é necessário se a origem vem de `req.url`; usar o que o build aceitar.

- [ ] **Step 1: Testes que falham:**
  ```ts
  it("devolve client_id igual à própria URL e redirect_uris com /configuracoes/callback", async () => {
    const res = await GET(new Request("https://jobfind.example/.well-known/oauth-cimd"));
    expect(await res.json()).toMatchObject({ client_id: "https://jobfind.example/.well-known/oauth-cimd",
      redirect_uris: ["https://jobfind.example/configuracoes/callback"], token_endpoint_auth_method: "none" });
  });
  it("recusa origem http que não é localhost", async () => {
    expect((await GET(new Request("http://evil.example/.well-known/oauth-cimd"))).status).toBe(400);
  });
  ```
- [ ] **Step 2:** Rodar → FAIL. **Step 3:** Implementar. Conferir que `proxy.ts` (matcher em `:30`) não intercepta `/.well-known/*` e que `app/robots.ts` não precisa mudar.
- [ ] **Step 4:** `pnpm test && pnpm build` → PASS; `curl -s localhost:3000/.well-known/oauth-cimd` com `pnpm start` mostra o JSON.
- [ ] **Step 5: Commit** `feat(ia): documento CIMD para o OAuth do Hugging Face`.

### Task 5: Adaptador HF, registro e CSP

**Files:**
- Create: `lib/client/ai/oauth/huggingface.ts`; Test: `tests/unit/client/ai/oauth-huggingface.test.ts`
- Modify: `lib/client/ai/providers.ts` (entrada `huggingface`), `lib/shared/ai-hosts.ts`, `components/settings/ProviderCard.tsx` (`DESCRIPTIONS.huggingface`, botão "ou colar token"), `tests/unit/client/ai/providers.test.ts`

**Interfaces:**
- Consumes: `OAuthFlow` (Task 1), `callbackUrl` (Task 2).
- Produces: `export const huggingFaceFlow: OAuthFlow`.
  - `authorizeUrl`: `https://huggingface.co/oauth/authorize` com `client_id=${origin}/.well-known/oauth-cimd`, `redirect_uri`, `response_type=code`, `scope=openid inference-api`, `code_challenge`, `code_challenge_method=S256`, `state`.
  - `exchange`/`refresh`: `POST https://huggingface.co/oauth/token`, `Content-Type: application/x-www-form-urlencoded`, corpo `grant_type=authorization_code&code&code_verifier&redirect_uri&client_id` / `grant_type=refresh_token&refresh_token&client_id`. Resposta → `{ key: access_token, refreshToken: refresh_token, expiresAt: new Date(Date.now() + expires_in*1000).toISOString() }`. 400/401 → `AiError("invalid_key", { meta: { reason: "expired" } })` no refresh, `"invalid_key"` na troca; resposta sem `access_token` → `AiError("unavailable", { meta: { reason: "invalid_response" } })`.
- Registro HF: `tier: "must"` (P-02), `auth: { kind: "oauth", flow: huggingFaceFlow, pasteFallback: true }`, `cspHosts: ["https://router.huggingface.co", "https://huggingface.co"]`, `keyHint: { prefix: "hf_", example: "hf_…" }`. `AI_CSP_HOSTS` ganha `"https://huggingface.co"`.
- Descrição do card: "Modelos abertos com login do Hugging Face. Créditos mensais gratuitos limitados; depois, a cobrança é na sua conta HF."

- [ ] **Step 1: Testes que falham:** URL de autorização (todos os parâmetros acima, `scope` exato `openid inference-api`); corpo form-urlencoded da troca e do refresh; cálculo de `expiresAt` com `vi.setSystemTime`; 401 no refresh → `invalid_key`/`expired`; `providers.test.ts`: `PROVIDERS.huggingface.auth.kind === "oauth"` e `tier === "must"`.
- [ ] **Step 2:** Rodar → FAIL. **Step 3:** Implementar. Card: com `pasteFallback`, botão secundário "Colar token" chama `onAdd`.
- [ ] **Step 4:** `pnpm typecheck && pnpm test` → PASS (inclui o teste de igualdade da CSP).
- [ ] **Step 5: Commit** `feat(ia): login OAuth do Hugging Face`.

### Task 6: Refresh com trava, "Reconectar" e backup

**Files:**
- Create: `lib/client/ai/oauth/refresh.ts`; Test: `tests/unit/client/ai/oauth-refresh.test.ts`
- Modify: `lib/client/ai/model.ts:47-72` (`resolveTaskModel`), `lib/client/ai/test-connection.ts`, `components/settings/ProviderCard.tsx`, `components/ai/messages.ts`, `lib/client/storage/backup.ts:226-232`
- Test: `tests/unit/client/backup.test.ts`, `tests/unit/client/ai/model.test.ts`

**Interfaces:**
- Consumes: `aiSettingsStore`, `PROVIDERS[id].auth.flow.refresh` (Task 5).
- Produces: `export async function ensureFreshKey(id: ProviderId): Promise<string | undefined>` — lê `aiSettingsStore`; se não há `expiresAt` ou faltam mais de 5 min (`REFRESH_MARGIN_MS = 5 * 60_000`), devolve `key`; senão faz **um** refresh por provedor (`Map<ProviderId, Promise<string>>` em módulo), grava `key/refreshToken/expiresAt` e devolve a chave nova. Em `invalid_key`, relê o storage: se outra aba já renovou (`expiresAt` novo no futuro), usa; senão relança `AiError("invalid_key", { meta: { reason: "expired" } })`.
- `resolveTaskModel` e `testConnection` usam `await ensureFreshKey(id)` no lugar de `cfg?.key`.

- [ ] **Step 1: Testes que falham:**
  ```ts
  it("duas chamadas concorrentes perto de expirar fazem um único refresh", async () => {
    const [a, b] = await Promise.all([ensureFreshKey("huggingface"), ensureFreshKey("huggingface")]);
    expect(refreshMock).toHaveBeenCalledTimes(1); expect(a).toBe("hf_new"); expect(b).toBe("hf_new");
  });
  it("token longe de expirar não chama refresh", …
  it("refresh 401 sem renovação em outra aba lança invalid_key/expired", …
  it("refresh 401 mas storage já renovado por outra aba devolve a chave do storage", …
  // backup.test.ts
  it("exportBackup não inclui refreshToken", () => { …; expect(JSON.stringify(exportBackup())).not.toContain("rt-secret"); });
  // provider-card: entry com expiresAt no passado e erro expired → texto "Sessão expirada" e botão "Reconectar"
  ```
- [ ] **Step 2:** Rodar → FAIL. **Step 3:** Implementar; em `backup.ts` remover `refreshToken` junto com `key`; mensagem em `messages.ts` para `invalid_key` + `reason: "expired"`: "A sessão com o provedor expirou. Reconecte nas configurações."
- [ ] **Step 4:** `pnpm typecheck && pnpm lint && pnpm test` → PASS.
- [ ] **Step 5: Commit** `feat(ia): renovação de token OAuth e reconexão`.

---

## Fase 3 — Colar chave mais fácil (independente das Fases 1–2, exceto o tipo `KeyHint` da Task 1)

### Task 7: Dicas de chave, sugestão de provedor, teste ao salvar

**Files:**
- Create: `lib/client/ai/key-hint.ts`; Test: `tests/unit/client/ai/key-hint.test.ts`
- Modify: `lib/client/ai/providers.ts` (`keyHint`, `keySteps`, `keyDocsUrl` revisados), `components/settings/AddKeyDialog.tsx`, `components/settings/AiSettingsScreen.tsx` (`saveKey` passa a receber chave já testada)
- Test: `tests/unit/client/add-key-dialog.test.tsx` (criar), `tests/e2e/settings.spec.ts`

**Interfaces:**
- Consumes: `KeyHint` (Task 1), `testConnection` (existente / Task 6).
- Produces: `export function checkKey(id: ProviderId, key: string): { warning: string | null; suggest: ProviderId | null }` — prefixo do próprio provedor ausente → aviso "Essa chave não parece ser do(a) <label>. Confira se copiou a chave certa."; prefixo **mais longo** que casa com outro provedor (ordenar por tamanho para `sk-ant-`/`sk-or-` vencerem `sk-`) → `suggest` e aviso "Parece uma chave do(a) <label do sugerido>." Nunca bloqueia.
- Valores (usar só os confirmados na Task 0; os demais ficam sem `keyHint`): OpenRouter `sk-or-`, OpenAI `sk-`, Anthropic `sk-ant-`, Google `AIza`, Groq `gsk_`, xAI `xai-`, Hugging Face `hf_`. Revisar `keyDocsUrl` de Cerebras, xAI e Vercel para a página de criar chave confirmada na Task 0.
- `AddKeyDialog`: botão "Salvar" vira "Testar e salvar"; roda `testConnection(provider, { apiKey })`; `invalid_key` mantém aberto com "O provedor recusou essa chave."; `unavailable`/`rate_limit` salva e mostra toast "Chave salva, mas não deu para testar agora." `keySteps` (até 3 linhas) aparece no `DialogDescription` quando existir.

- [ ] **Step 1: Testes que falham:**
  ```ts
  it("sk-ant- colada no OpenAI sugere anthropic", () => expect(checkKey("openai", "sk-ant-abc").suggest).toBe("anthropic"));
  it("sk-or- no OpenRouter não avisa", () => expect(checkKey("openrouter", "sk-or-v1-x")).toEqual({ warning: null, suggest: null }));
  it("provedor sem keyHint nunca avisa", () => expect(checkKey("deepseek", "qualquer").warning).toBeNull());
  // add-key-dialog: 401 mockado em testConnection mantém o diálogo e mostra "O provedor recusou essa chave."; erro de rede chama onSave
  ```
  E2E: colar `sk-ant-x` no card OpenAI mostra "Parece uma chave do(a) Anthropic (Claude)" e o botão continua habilitado.
- [ ] **Step 2:** Rodar → FAIL. **Step 3:** Implementar.
- [ ] **Step 4:** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e tests/e2e/settings.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat(ia): dicas de chave e teste ao salvar`.

---

## Fase 4 — Documentação

### Task 8: Privacidade e specs

**Files:**
- Modify: `app/(site)/privacidade/page.tsx`, `docs/tech/2026-11-23-job-find-agregador-vagas-tech.md` (D-10, D-17, item do registro na linha ~379), `docs/tech/2026-11-24-oauth-provedores-ia.md` (histórico com resultado do spike)

- [ ] **Step 1:** `/privacidade`: parágrafo "Login do Hugging Face: pedimos só a permissão de fazer pedidos de IA em seu nome (`inference-api`) e a identificação básica (`openid`). Não lemos seus repositórios nem seu e-mail. O token fica só neste navegador."
- [ ] **Step 2:** Atualizar D-10 ("OAuth no OpenRouter e no Hugging Face; colar chave nos demais") e a descrição de `auth` no registro.
- [ ] **Step 3:** `pnpm lint && pnpm build && pnpm test:e2e` (suíte completa, inclui CSP) → PASS.
- [ ] **Step 4: Commit** `docs(ia): OAuth dos provedores`.

---

## Dependências e paralelismo

| Task | Depende de | Paralelizável com |
|------|-----------|-------------------|
| 0 | — | 1, 2, 3, 7 |
| 1 | — | 0 |
| 2 | 1 | 4 |
| 3 | 2 | 4 |
| 4 | — (resultado da 0 decide se existe) | 2, 3, 7 |
| 5 | 0, 1, 2 | 7 |
| 6 | 5 | 7 |
| 7 | 1 (tipo `KeyHint`), 0 (valores) | 2–6 (toca `AddKeyDialog` e `key-hint.ts`; em `providers.ts` só os campos novos) |
| 8 | 5, 6 | — |
