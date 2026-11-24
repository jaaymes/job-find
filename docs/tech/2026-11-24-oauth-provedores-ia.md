# Spec técnica: integração de provedores de IA mais fácil, com OAuth onde existe

- **Data:** 2026-11-24
- **Origem:** pedido do usuário na conversa, sem PRD próprio. PRD base: [docs/prd/2026-11-23-job-find-agregador-vagas-tech.md](../prd/2026-11-23-job-find-agregador-vagas-tech.md)
- **Specs base:** [D-10 e D-17 da spec principal](2026-11-23-job-find-agregador-vagas-tech.md), [openrouter-gratuito](2026-11-24-openrouter-gratuito.md)
- **Pesquisa:** Context7 (`/huggingface/hub-docs`, `/huggingface/huggingface.js`, `/websites/ai_google_dev_gemini-api`, `/websites/vercel`) e `https://huggingface.co/.well-known/openid-configuration`, lidos em 2026-11-24.

## 1. Requisitos (premissas registradas a partir do pedido)

| ID | Requisito |
|----|-----------|
| RF-01 | Revisar cada provedor do registro e, onde o provedor oferecer, conectar por **OAuth** (login no provedor, sem colar chave), como já é feito no OpenRouter. |
| RF-02 | Tornar a integração mais fácil também para quem só tem "colar chave": validação e dicas por provedor, link direto para a página de criar chave, teste automático ao salvar. |
| RF-03 | Adicionar um provedor OAuth novo deve exigir só uma entrada no registro (sem duplicar callback, PKCE e tratamento de erro). |
| RNF-01 | Continua tudo no navegador (local-first): nenhum segredo de cliente, nenhuma chamada de IA passa pelos nossos servidores. |
| RNF-02 | Sem variáveis de ambiente nem feature flags novas (regra do projeto). |
| RNF-03 | Só serviços gratuitos para o uso real: o OAuth e o registro do app não podem custar nada. |
| RNF-04 | Tokens nunca vão a URL, log, mensagem de erro nem ao backup de dados. |

## 2. O que já existe (fatos do código)

- Registro único em `lib/client/ai/providers.ts`. `ProviderDef.auth` é `"pkce" | "paste" | "none"` (`providers.ts:41`). Só o OpenRouter usa `pkce`.
- O PKCE é **específico do OpenRouter**: URLs fixas, `limit=5`, `expiration=1-year`, troca em `/api/v1/auth/keys` (`lib/client/ai/pkce.ts:5-6`, `:41-46`). Não usa `state`.
- O callback `app/(local)/configuracoes/callback/page.tsx` grava sempre em `providers.openrouter` e os textos citam o OpenRouter.
- `AiSettings.providers[id]` guarda `key`, `source: "pkce" | "paste"`, sem expiração nem refresh (`lib/client/ai/settings.ts:24-35`).
- `ProviderCard` decide botão e texto por `def.auth === "pkce"` e `def.id === "openrouter"` (`components/settings/ProviderCard.tsx:57-60`, `:87-92`, `:139`); `AiSettingsScreen` só tem `connectPkce` do OpenRouter (`AiSettingsScreen.tsx:107-120`).
- `AddKeyDialog` só checa vazio/espaço (`AddKeyDialog.tsx:19-27`). Não testa a chave ao salvar.
- CSP `connect-src` vem de `lib/shared/ai-hosts.ts`; o teste do registro exige que seja igual aos `cspHosts` (`tests/unit/client/ai/providers.test.ts`).
- O backup já remove `key` dos provedores (`lib/client/storage/backup.ts:226-232`).
- Testes existentes: `tests/unit/client/ai/pkce.test.ts`, `tests/e2e/settings.spec.ts:130-153` (PKCE mockado e callback).

## 3. Revisão provedor a provedor

| Provedor | OAuth para app de terceiros no navegador? | Decisão | Evidência |
|----------|------------------------------------------|---------|-----------|
| OpenRouter | Sim, PKCE sem client_id, gera chave com limite | **Mantém** (migra para o módulo genérico) | já implementado |
| **Hugging Face** | **Sim.** OAuth/OIDC com PKCE para app público (sem secret), escopo `inference-api` ("Inference Providers on behalf of the user"), **CIMD**: o `client_id` é uma URL nossa que devolve um JSON, sem cadastrar app nem guardar client_id. `refresh_token` suportado. Token padrão de 8 h. | **Adicionar OAuth** | hub-docs `oauth.md` (Public OAuth apps, CIMD, scopes); openid-configuration (`client_id_metadata_document_supported: true`, `grant_types` com `refresh_token`, `code_challenge_methods: S256`) |
| Google Gemini | Existe OAuth, mas exige projeto no Google Cloud **do usuário**, tela de consentimento, verificação do Google para escopo sensível, header `x-goog-user-project` e o quickstart é para app desktop com `client_secret`. | **Não** (colar chave do AI Studio continua mais simples) | Gemini API `docs/oauth` |
| Vercel AI Gateway | "Sign in with Vercel" é OAuth com PKCE, **mas a troca exige `client_secret`** (ou OIDC do servidor), e o AI Gateway aceita só API key ou token OIDC do projeto, não o token do usuário. | **Não** | vercel.com/docs/sign-in-with-vercel, ai-gateway/authentication-and-byok |
| OpenAI | Não há OAuth público para a API. O login "Sign in with ChatGPT" é do Codex; usar o client_id dele em outro app viola os termos. | **Não** | sem doc pública para terceiros |
| Anthropic | Mesmo caso: o OAuth do Claude é para os apps da própria Anthropic; os termos proíbem uso por terceiros. | **Não** | idem |
| DeepSeek, Groq, Mistral, Cerebras, xAI, Together, Fireworks | Só chave de API. | **Não**; melhorar o "colar chave" (D-04) | sem OAuth documentado |
| IA local | Sem autenticação. | Sem impacto | — |

> Resultado honesto: além do OpenRouter, **só o Hugging Face** permite OAuth de verdade num app 100% no navegador, sem segredo e sem custo. Para os demais, o ganho de facilidade vem do D-04.

## 4. Decisões

### D-01: módulo OAuth genérico, dirigido pelo registro (RF-03)
- **Contexto:** `pkce.ts` e o callback são do OpenRouter. Um segundo provedor duplicaria tudo.
- **Opções:** (a) copiar `pkce.ts` para `hf-oauth.ts` e um segundo callback; (b) usar `@huggingface/hub` (`oauthLoginUrl`/`oauthHandleRedirectIfPresent`) para o HF e manter o OpenRouter à parte; (c) módulo genérico `lib/client/ai/oauth.ts` com adaptadores por provedor no registro.
- **Decisão:** (c).
  - `ProviderDef.auth` vira união discriminada:
    ```ts
    type AuthDef =
      | { kind: "oauth"; flow: OAuthFlow; pasteFallback?: boolean }   // OpenRouter, Hugging Face
      | { kind: "paste" }
      | { kind: "none" };
    // `keyDocsUrl`, `keyHint` e `keySteps` ficam no topo do ProviderDef (menos churn).
    type OAuthFlow = {
      authorizeUrl(p: { redirectUri: string; challenge: string; state: string }): string;
      exchange(p: { code: string; verifier: string; redirectUri: string }): Promise<OAuthTokens>;
      refresh?(refreshToken: string): Promise<OAuthTokens>;
    };
    type OAuthTokens = { key: string; refreshToken?: string; expiresAt?: string };
    ```
  - `oauth.ts` faz o que é comum: verifier/challenge S256 (código atual de `pkce.ts`), `state` aleatório, guarda `{ provider, verifier, state, intent }` no `sessionStorage` sob uma chave só, valida o `state` no retorno, limpa tudo em qualquer desfecho e nunca põe code/verifier/token em erro ou log.
  - Adaptador OpenRouter: o atual (`/auth` + `/api/v1/auth/keys`, `limit=5`, `expiration=1-year`). O OpenRouter não documenta `state`; ele vai junto na `callback_url` como query e é conferido no retorno.
  - Adaptador Hugging Face: `https://huggingface.co/oauth/authorize` com `client_id=<origem>/.well-known/oauth-cimd`, `scope=openid inference-api`, `response_type=code`, PKCE S256, `state`; troca e refresh em `https://huggingface.co/oauth/token` (`application/x-www-form-urlencoded`).
- **Por que não (a):** duplicação que já precisa ficar em sincronia hoje (texto, erros, testes). **Por que não (b):** dependência nova (~centenas de KB do `@huggingface/hub`) para 2 requisições, e dois fluxos diferentes no app. O código do PKCE já existe e é testado.
- **Consequências:** `pkce.ts` vira `oauth.ts` + adaptador; `pkce.test.ts` é migrado. `takeFreeConsentIntent` vira o campo `intent` do fluxo pendente.

### D-02: callback único, provedor vindo do fluxo pendente
- **Opções:** (a) uma rota por provedor (`/configuracoes/callback/[provider]`); (b) a rota atual, com o provedor lido do `sessionStorage` via `state`.
- **Decisão:** (b). `/configuracoes/callback` continua sendo o `redirect_uri` (a URL já cadastrada/esperada no OpenRouter e nos testes E2E). O callback lê o fluxo pendente, chama `PROVIDERS[id].auth.flow.exchange`, grava em `providers[id]` e usa `def.label` nos textos.
- **Por quê:** um `redirect_uri` só, exato, para o CIMD; nada de provedor na URL (que o atacante poderia trocar).

### D-03: CIMD do Hugging Face sem cadastro nem env var (RNF-02, RNF-03)
- **Contexto:** o OAuth do HF precisa de `client_id`. Cadastrar um app e guardar o id seria config nova por ambiente (prod, preview, forks).
- **Opções:** (a) cadastrar um OAuth app público no HF e fixar o client_id no código; (b) env var com o client_id; (c) **CIMD**: rota `app/.well-known/oauth-cimd/route.ts` que devolve o JSON com `client_id` = URL da própria rota, `redirect_uris` = `<origem>/configuracoes/callback`, `token_endpoint_auth_method: "none"`, `client_name: "Job Find"`, `logo_uri`, `client_uri`.
- **Decisão:** (c). A origem vem da requisição (cada deploy/preview/fork é o próprio cliente). Resposta estática por origem, `Cache-Control` público curto.
- **Por que não (a):** fork e preview quebram (redirect URI fixo). **Por que não (b):** proibido pela regra do projeto.
- **Consequências:** em `localhost` o HF não alcança o CIMD, então em dev o botão "Conectar" do HF mostra o erro do HF; o "colar token" fica disponível como alternativa (D-05). Validar no spike se o HF aceita origens de preview `*.vercel.app` (deve, é só uma URL https pública).
- **Segurança:** a rota só devolve dados públicos e fixos; `redirect_uris` é derivado do `Host`, mas o HF busca o documento na própria URL do `client_id`, então um `Host` forjado só afeta o documento servido àquele host. Fixar a origem a partir de `x-forwarded-host` da Vercel e validar formato (https, sem path).

### D-04: "colar chave" mais fácil (RF-02)
- **Decisões:**
  1. `keyHint` por provedor no registro: prefixo esperado e exemplo mascarado (ex.: OpenAI `sk-`, Anthropic `sk-ant-`, Gemini `AIza`, Groq `gsk_`, Hugging Face `hf_`, xAI `xai-`, OpenRouter `sk-or-`). **Aviso leve**, nunca bloqueio ("Essa chave não parece ser da Anthropic. Confira se copiou a chave certa."), porque formatos mudam. Prefixos são **premissa** a confirmar provedor a provedor no spike; provedor sem prefixo confirmado fica sem `keyHint`.
  2. Detecção de provedor pelo prefixo: se a chave colada tem o prefixo de **outro** provedor, o aviso sugere o card certo.
  3. **Testar ao salvar:** `AddKeyDialog` chama `testConnection` antes de fechar; erro `invalid_key` mantém o diálogo aberto com a mensagem; erro de rede/limite salva e avisa ("salvamos, mas não deu para testar agora").
  4. `keyDocsUrl` aponta para a **página de criar chave**, não para docs: revisar Cerebras (`/platform`), xAI (`console.x.ai`) e Vercel (`/docs/ai-gateway`). Lista final confirmada no spike.
  5. Passo a passo curto (3 linhas) por provedor no diálogo, no lugar do texto genérico, vindo do registro (`keySteps?: string[]`).
- **Fora:** colar uma chave única e "descobrir" o provedor sozinho como fluxo principal (gold plating; o aviso do item 2 cobre o erro comum).

### D-05: tokens com expiração e refresh (RNF-04)
- **Contexto:** a chave do OpenRouter dura 1 ano; o token do HF dura ~8 h, com `refresh_token`.
- **Decisão:**
  - `AiSettings.providers[id]` ganha `source: "oauth"` (com `"pkce"` aceito como legado e lido como `"oauth"`), `refreshToken?: string`, `expiresAt?: string`. Campos opcionais, sem migração (`partialRecord`).
  - Antes de criar o modelo (`model.ts`/`generate.ts`), se `expiresAt` está a menos de 5 min, chama `flow.refresh` e grava o novo par. Um único refresh em andamento por provedor (promise compartilhada) para não queimar o refresh token em chamadas paralelas.
  - Refresh falhou com 400/401 → `AiError("invalid_key", { meta: { reason: "expired" } })`; o card mostra "Sessão expirada" e o botão **"Reconectar"**.
  - `refreshToken` também fica fora do backup (`backup.ts`, mesmo tratamento de `key`) e o card nunca mostra os últimos 4 dígitos dele.
  - HF ainda aceita "Colar token" (`hf_...`, token fine-grained com permissão de Inference Providers) como alternativa ao login: `auth` do HF é `oauth` com `pasteFallback: true`.

### D-06: UI genérica dos cards
- `ProviderCard` passa a decidir por `def.auth.kind`: `oauth` → "Conectar com <label>" (+ "ou colar token" quando `pasteFallback`), `paste` → "Adicionar chave", `none` → "Configurar". Texto do conectado: "Conectado pelo login do <label> em <data>".
- `AiSettingsScreen.connectPkce` vira `connectOAuth(id)`; o aviso dos modelos gratuitos continua só para o OpenRouter (regra existente em D-02 da spec do OpenRouter gratuito).
- O Hugging Face sobe para o grupo **Must** (passa a ter login de 1 clique) — **pergunta em aberto P-02**.

### D-07: CSP
- Adicionar `https://huggingface.co` ao `cspHosts` do HF e a `AI_CSP_HOSTS` (token e refresh). O teste do registro já garante a igualdade. `form-action`/navegação para `huggingface.co/oauth/authorize` é `window.location.assign`, não afetado pelo `connect-src`.

## 5. Eixos sem impacto
Banco/migrações (tudo no `localStorage`), APIs do back-end (só a rota estática do CIMD), filas/cron, performance (2 requisições a mais por login; refresh a cada ~8 h).

## 6. Segurança (resumo)
| Ameaça | Mitigação |
|--------|-----------|
| CSRF / login forçado no callback | `state` aleatório de 32 bytes, guardado no `sessionStorage` e comparado em tempo constante; sem `state` válido não troca o code |
| Code ou token em URL/histórico | `history.replaceState` antes de tudo (já existe); tokens só em `localStorage`, nunca em query |
| Troca de provedor pela URL | provedor vem do fluxo pendente, não da URL (D-02) |
| Vazamento do refresh token | fora do backup e da UI; mesmo nível de proteção da chave atual (CSP + sanitização, D-15) |
| Escopo excessivo no HF | só `openid inference-api`; sem `email`, `read-repos` etc. |
| CIMD com host forjado | valida formato da origem; documento só com dados públicos (D-03) |

## 7. Testes
- **Unit:** `oauth.ts` (verifier/challenge, `state` inválido, limpeza em erro, sem segredo em `AiError`), adaptadores OpenRouter e HF (URL de autorização, corpo da troca e do refresh, resposta inválida), refresh concorrente (uma chamada só), `keyHint` (aviso e sugestão de outro provedor), schema de settings (legado `pkce`), backup sem `refreshToken`, rota CIMD (JSON e origem).
- **E2E (`settings.spec.ts`):** OpenRouter continua passando sem mudar o teste; HF: "Conectar" vai para `huggingface.co/oauth/authorize` com `client_id` terminando em `/.well-known/oauth-cimd`, callback mockado com `state` correto conecta, `state` errado mostra erro; "Adicionar chave" com prefixo errado mostra aviso; salvar com chave recusada (401 mockado) mantém o diálogo aberto; CSP sem violações no callback.
- **Spike manual (Fase 0):** login real no HF a partir de um preview na Vercel; confirmar CORS do `/oauth/token`, duração e rotação do refresh token, e que o token chama `router.huggingface.co/v1/chat/completions`.

## 8. Plano de entrega

| Fase | Entrega | Esforço | Depende |
|------|---------|---------|---------|
| 0 — Spike | Confirmar no HF real: CIMD em preview, CORS do token, refresh, chamada ao router; confirmar prefixos e links de chave | P | — |
| 1 — Módulo OAuth genérico | `AuthDef`, `oauth.ts`, adaptador OpenRouter, callback genérico com `state`; OpenRouter funcionando igual (E2E atual verde) | M | — |
| 2 — Hugging Face OAuth | rota CIMD, adaptador HF, CSP, `source: "oauth"`, `expiresAt`/`refreshToken`, refresh com trava, "Reconectar", backup | M | 0, 1 |
| 3 — Colar chave mais fácil | `keyHint`, sugestão de provedor, testar ao salvar, `keySteps`, links revisados | P/M | 0 (prefixos/links); independente das fases 1–2 |
| 4 — Docs | `/privacidade` (login HF e escopo), atualizar D-10/D-17 da spec principal | P | 2 |

Caminho crítico: 0 → 1 → 2. A fase 3 pode rodar em paralelo com 1–2 (arquivos diferentes: `AddKeyDialog`, `providers.ts` só nos campos novos).

## 9. Riscos

| Risco | Prob. | Impacto | Mitigação |
|-------|-------|---------|-----------|
| HF não aceitar CIMD de origens de preview ou bloquear CORS do token no navegador | Baixa | Alto | Spike na Fase 0; plano B: cadastrar OAuth app público no HF e fixar o client_id no código (exige ok do usuário) |
| Créditos grátis do HF Inference Providers são pequenos e o usuário acha que "não funciona" | Média | Médio | Texto do card: "créditos mensais gratuitos limitados; depois, cobrança na sua conta HF"; erro `no_credit` (402) já mapeado |
| Prefixo de chave desatualizado gera aviso falso | Média | Baixo | Aviso leve, nunca bloqueia; só prefixos confirmados |
| Refresh token rotativo usado duas vezes em abas diferentes | Média | Médio | Trava por aba + em erro `invalid_grant`, reler o storage (outra aba pode ter renovado) antes de pedir "Reconectar" |

## 10. Decisões do usuário (2026-11-24)

| # | Pergunta | Resposta |
|---|----------|----------|
| P-01 | OAuth só em OpenRouter + Hugging Face, já que os outros não oferecem OAuth para apps de terceiros? | Aceito (seguiu para o plano) |
| P-02 | O Hugging Face sobe para o grupo principal (Must) na tela? | **Sim** |
| P-03 | Se o CIMD não servir, cadastrar um OAuth app público no HF e fixar o client_id no código (sem env var)? | **Sim, como plano B** |
