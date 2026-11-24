# Spec técnica: caminho gratuito pelo OpenRouter

- **Data:** 2026-11-24
- **Origem:** pedido do usuário na conversa, sem PRD próprio. PRD base: [docs/prd/2026-11-23-job-find-agregador-vagas-tech.md](../prd/2026-11-23-job-find-agregador-vagas-tech.md)
- **Spec base:** [docs/tech/2026-11-23-job-find-agregador-vagas-tech.md](2026-11-23-job-find-agregador-vagas-tech.md), [docs/tech/2026-11-24-ajustes-importacao-modelos-tema.md](2026-11-24-ajustes-importacao-modelos-tema.md)
- **Pesquisa:** documentação oficial do OpenRouter (via Context7 e openrouter.ai/docs), lida em 2026-11-24 por subagente

## 1. Requisitos (premissas registradas a partir do pedido)

| ID | Requisito |
|----|-----------|
| RF-01 | Guiar quem ainda não conectou IA a escolher o **OpenRouter**, explicando que dá para usar só modelos gratuitos. |
| RF-02 | Texto empático **sem presumir** a situação financeira da pessoa (decisão do usuário). Ideia: procurar emprego já pesa no bolso, então o Job Find funciona com IA gratuita, que não é ilimitada mas basta para achar boas vagas e fazer boas análises. |
| RF-03 | O gratuito vem da **conta OpenRouter do próprio usuário** (decisão do usuário). Nada de chave nem servidor da Job Find. Continua valendo que as chamadas não passam pelos nossos servidores. |
| RF-04 | Pontos de entrada: (a) card do OpenRouter em destaque em Configurações; (b) os avisos "sem IA conectada" em Perfil, Análise de vaga e Gerador conectam o OpenRouter grátis com 1 clique; (c) filtro "Só gratuitos" no seletor de modelo e, ao conectar pelo fluxo grátis, as 3 tarefas já ficam em modelos gratuitos. |
| RF-05 | Deixar claro que é **limitado** e mostrar quanto resta no dia. |
| RNF-01 | O fluxo grátis nunca gera cobrança. |
| RNF-02 | Avisar com clareza o que muda na privacidade com modelos gratuitos (LGPD). |
| Fora | Proxy ou chave compartilhada da Job Find. Créditos pagos patrocinados. Novas variáveis de ambiente ou feature flags (regra do projeto): tudo já entra ativo. |

## 2. O que já existe (fatos do código)

- O OpenRouter já é o primeiro provedor do registro, com login OAuth PKCE (`lib/client/ai/providers.ts:280`, `lib/client/ai/pkce.ts:528`). A chave sai com `limit=5` (US$) e `expiration=1-year` (`pkce.ts:540`).
- O callback salva a chave e volta para `/configuracoes` (`app/(local)/configuracoes/callback/page.tsx`). Não sabe "por que" o usuário conectou.
- `listOpenRouter` já lê o preço (`providers.ts:194`). `sortModelsByCost` coloca os grátis primeiro e `priceLabel` mostra "grátis" (`components/settings/cost.ts`).
- O `TaskModelRow` já avisa sobre modelos `:free` (`components/settings/TaskModelRow.tsx:77` e `:169`).
- `providerOptions` do OpenRouter manda `require_parameters: true` e, se `dataCollectionDeny` (padrão **true**), `data_collection: "deny"` (`lib/client/ai/generate.ts:57-66`).
- Já existe o erro `data_policy` com mensagem própria (`lib/client/ai/errors.ts:84`, `components/ai/messages.ts`).
- `NoProviderCta` só manda para `/configuracoes` (`components/settings/NoProviderCta.tsx`). É usado em `ProfileScreen.tsx:70`, `AiAnalysis.tsx:202` e `GeneratorScreen.tsx:307`.
- `checkOpenRouterKey` já chama `GET /api/v1/key` (`lib/client/ai/test-connection.ts:9`).
- E-mail, telefone e endereço nunca vão à IA, e o nome é redigido (`lib/client/ai/prompts/shared.ts:42-81`).

## 3. Fatos do OpenRouter que pesam na decisão

| Fato | Fonte |
|------|-------|
| Modelos grátis: 20 req/min. **50 req/dia** se a conta comprou menos de 10 créditos na vida, 1000/dia com 10 ou mais. Saldo zero não bloqueia. Saldo negativo bloqueia. | docs/api/reference/limits, docs/faq |
| Quando estoura: HTTP 429 `rate_limit_exceeded` com `X-RateLimit-Reset`. Se estourar no meio do stream, vem SSE com `finish_reason: "error"`. | docs/api/reference/limits |
| `GET /api/v1/key` devolve `free_model_daily_requests {used, limit, remaining}` do dia UTC. | docs/api/reference/limits |
| `openrouter/free` é um roteador **sempre gratuito**: filtra os modelos grátis que suportam o que a requisição pede (incluindo structured outputs) e sorteia um. Faz fallback só entre grátis. | docs/guides/routing/routers/free-router |
| Grátis no catálogo: `pricing.prompt === "0"` e `pricing.completion === "0"`, e as entradas `:free`. O catálogo muda com frequência. | docs/guides/overview/models |
| A conta tem toggles **separados** para modelos grátis que **treinam** com os dados e que **publicam prompts**. Sem eles, muitos endpoints grátis ficam indisponíveis e a requisição falha. | docs/guides/privacy/provider-logging, guardrails API |
| `data_collection: "deny"` restringe aos provedores que não coletam dados. **Não confirmado:** que zera os endpoints grátis (hipótese forte). | docs/guides/routing/provider-selection |

## 4. Decisões

### D-01: modelo gratuito padrão
- **Contexto:** o fluxo grátis precisa já sair funcionando nas 3 tarefas, sem fixar slugs que somem do catálogo.
- **Opções:** (a) fixar slugs `:free` conhecidos no código; (b) escolher na conexão, pelo `/models`, o grátis com `structured_outputs`; (c) usar o roteador `openrouter/free`.
- **Decisão:** (c) como padrão das 3 tarefas no fluxo grátis. Constante `OPENROUTER_FREE_MODEL = "openrouter/free"` em `providers.ts`. O usuário ainda pode trocar por um `:free` específico com o filtro (D-05).
- **Por quê:** não fixa slugs, faz fallback sozinho, nunca cobra e respeita o `require_parameters` que já enviamos. **Por que não (a):** quebra quando o catálogo muda. **Por que não (b):** escolhe um modelo só e não tem fallback quando ele está indisponível.
- **Consequências:** a qualidade varia de uma chamada para outra (o modelo é sorteado). Isso é mitigado pela validação Zod + `jsonrepair` que já existe em `generate.ts`. A extração de currículo é a tarefa mais exigente, então o spike (Fase 0) mede a taxa de sucesso. Se ficar abaixo de ~80%, a extração passa a usar o melhor `:free` com `structured_outputs` escolhido em tempo de execução.
- **Revisão (2026-11-24, decisão do usuário):** o `openrouter/free` ("Free Models Router") virou o `defaultModels` do OpenRouter nas 3 tarefas, para **qualquer** conexão, e não só no fluxo grátis. Já está implementado em `providers.ts` (`OPENROUTER_FREE_MODEL`, `isFreeModel`). Os modelos pagos continuam na lista.
- **Resposta cortada (implementado):** todos os modelos gratuitos raciocinam, e o raciocínio conta no `max_tokens`. Por isso o OpenRouter recebe uma folga de 6000 tokens, `reasoning.exclude: true` e, se ainda vier `finish_reason: "length"`, uma 2ª tentativa com o dobro do orçamento (`lib/client/ai/generate.ts`).

### D-02: privacidade no modo grátis (RNF-02)
- **Contexto:** com `dataCollectionDeny = true` (padrão), o grátis tende a falhar. Os endpoints grátis podem treinar com os dados ou publicar o prompt. Mesmo redigido, o currículo é dado pessoal.
- **Opções:** (a) manter `deny` e deixar falhar; (b) ignorar `deny` em silêncio nos modelos grátis; (c) **consentimento explícito** antes de entrar no modo grátis e não mandar `deny` só para modelos grátis.
- **Decisão:** (c).
  - Função pura `isFreeModel(modelId)`: `true` para `openrouter/free` e para ids que terminam em `:free`. Em `providerOptions`, o `data_collection: "deny"` só é omitido quando `isFreeModel(modelId)`. Modelos pagos continuam respeitando a opção.
  - O fluxo grátis abre antes o diálogo de consentimento (reaproveitando o padrão de `PrivacyConsentDialog`). Ele explica que modelos gratuitos podem usar o texto enviado para treino ou publicá-lo, que e-mail, telefone, endereço e nome nunca são enviados, e que quem quiser mais privacidade pode usar um modelo pago ou a IA local.
  - Aceite salvo como `freeConsent: true` (campo opcional novo em `AiSettings.providers.openrouter`, sem migração: o schema é `partialRecord` com campos opcionais).
  - Modelo grátis sem `freeConsent` (escolhido no seletor) lança `blocked_by_privacy`, com a mesma regra de `needsPrivacyAck` em `model.ts`.
  - O texto da opção "Pedir ao OpenRouter que use só provedores que não guardam meus dados" ganha a nota "(não vale para modelos gratuitos)".
- **Erro de política da conta:** quando a conta não liberou os toggles de grátis, o erro de política (`data_policy` em `errors.ts:84`, detecção genérica porque o texto exato não está documentado) ganha uma mensagem própria para modelo grátis, com o link `https://openrouter.ai/settings/privacy` e o passo a passo: ligar "permitir endpoints gratuitos que podem treinar".
- **Página `/privacidade`:** adicionar um parágrafo sobre os modelos gratuitos do OpenRouter.
- **Implementado (2026-11-24):** como o roteador grátis virou o padrão de qualquer conexão do OpenRouter, o aviso aparece no botão **"Conectar"** do card, antes do login. Cancelar não abre o login. O aceite atravessa o redirect pelo `sessionStorage` (`takeFreeConsentIntent` em `pkce.ts`) e é gravado no callback. Quem já tinha conectado antes vê o botão "Revisar aviso dos modelos gratuitos". Sem o aceite, o modo automático pula o OpenRouter, e uma escolha explícita de modelo grátis lança `blocked_by_privacy` com `reason: "free_models"`. Modelos pagos do OpenRouter não exigem o aceite.
- **Pergunta em aberto (spike):** só o toggle de "treino" basta, ou também é preciso o de "publicação"? A orientação muda conforme a resposta. Se for preciso "publicação", o diálogo diz isso com destaque.

### D-03: fluxo "Conectar e usar grátis" (RF-01, RF-04a/b)
- **Contexto:** o callback do PKCE não sabe a intenção. O fluxo grátis precisa configurar as tarefas ao voltar.
- **Opções:** (a) parâmetro na `callback_url`; (b) intenção no `sessionStorage`, ao lado do verifier; (c) perguntar de novo depois do callback.
- **Decisão:** (b). `startOpenRouterAuth(callbackUrl, { intent: "free" })` grava `jobfind:pkce:intent`. `completeOpenRouterAuth` devolve `{ key, intent }` e limpa os dois em qualquer desfecho. Com `intent === "free"`, o callback salva a chave com `freeConsent: true` e marca as **tarefas sem escolha** (`null`) com `{ provider: "openrouter", model: OPENROUTER_FREE_MODEL }`. Escolhas explícitas já feitas não são sobrescritas. O callback também aceita um `returnTo` (só caminhos internos da allowlist `/perfil`, `/vagas/...`, `/gerador`, `/configuracoes`) para devolver a pessoa à tela de onde saiu.
- **Por que não (a):** a `callback_url` aparece no OpenRouter e no histórico, e o `sessionStorage` já é o mecanismo do verifier.
- **Ordem:** clique → diálogo de consentimento (D-02) → `startOpenRouterAuth` → OpenRouter → callback → tela de origem.
- **Componente compartilhado:** `useConnectFreeOpenRouter()` em `components/settings/`, usado pelo card e pelo `NoProviderCta`, para não duplicar consentimento + PKCE + tratamento de erro.

### D-04: textos e destaque (RF-01, RF-02)
- **Card do OpenRouter** em Configurações: selo "Grátis", borda de destaque e o texto: "Procurar emprego já pesa no bolso. Com uma conta gratuita no OpenRouter, o Job Find usa só modelos de IA gratuitos: não é ilimitado (cerca de 50 usos por dia), mas dá para encontrar as melhores vagas e fazer boas análises sem gastar nada." Dois botões: **"Conectar e usar grátis"** (principal) e **"Conectar"** (o fluxo atual, que usa os modelos recomendados).
- **Abaixo do título da página:** uma faixa curta, só quando nada está conectado: "Comece de graça: conecte o OpenRouter e use modelos gratuitos."
- **`NoProviderCta`:** mesmo texto curto + botão "Conectar OpenRouter grátis" (D-03) + link secundário "Ver outras opções em Configurações". Texto honesto: o gratuito vem do OpenRouter, a Job Find só configura. Nunca "nós oferecemos".
- **Quando o usuário já está conectado** com outro provedor, nenhum desses destaques aparece.
- Revisão de texto e visual: skill `impeccable` na execução.

### D-05: filtro "Só gratuitos" (RF-04c)
- `ModelInfo` ganha `free?: boolean`. `listOpenRouter` marca `free` quando `pricing.prompt === "0" && pricing.completion === "0"` (e `request`, se vier, também "0"). Também guarda `structured?: boolean` a partir de `supported_parameters` (`structured_outputs` ou `response_format`) e inclui `openrouter/free` no topo da lista com o rótulo "Grátis automático (recomendado)".
- No `TaskModelRow`, só quando o provedor ativo é o OpenRouter: checkbox "Só gratuitos". Liga sozinho quando o modelo atual é grátis. Com o filtro ligado, a lista mostra só os `free`, e os que não têm `structured` ficam com a nota "pode falhar em respostas estruturadas".
- O aviso atual `isFree` (`TaskModelRow.tsx:169`) passa a usar `isFreeModel` (cobre `openrouter/free`). O texto muda: o "evite enviar o currículo completo" é trocado pela referência ao consentimento já dado e ao limite diário.

### D-06: cota diária visível e limite estourado (RF-05)
- `getOpenRouterFreeUsage(apiKey)` em `test-connection.ts`, reaproveitando o fetch de `/api/v1/key`, lê `free_model_daily_requests` (Zod, campos opcionais; sem o campo, a UI some sem erro).
- Exibição: no card do OpenRouter conectado e embaixo de "Modelo para cada tarefa": "Gratuito: restam 37 de 50 usos hoje (renova às 21h)". A hora vem da meia-noite UTC convertida para o fuso local. Usa React Query com `staleTime` de 60 s e invalida depois de cada chamada de IA com modelo grátis.
- **429 com modelo grátis:** `mapProviderError` guarda `X-RateLimit-Reset` em `meta.resetAt`. Mensagem nova, quando a tarefa usa modelo grátis: "Você usou os usos gratuitos de hoje. Eles renovam às HHh. Até lá, dá para usar outro provedor ou um modelo pago." Para 429 por minuto (reset < 2 min): "Muitos pedidos seguidos. Espere um minuto."
- **Erro no meio do stream** (`finish_reason: "error"`): hoje já vira `unavailable` (`generate.ts:161`). Nada muda, porque o texto genérico serve.
- **Sem retry automático** no 429 diário: só desperdiçaria a cota.

### D-07: cobrança acidental (RNF-01)
- O fluxo grátis só grava `openrouter/free` ou ids `:free`. Nunca usa `models[]` com fallback pago nem `openrouter/auto`.
- A chave OAuth mantém `limit=5`: com saldo zero, não há como cobrar. Se a pessoa colocar crédito depois, o limite protege.
- Teste unitário: com intenção "free", nenhuma tarefa recebe modelo pago.

### Eixos sem impacto
Dados no servidor/migrações (tudo fica no `localStorage`, só um campo opcional novo), APIs do back-end, coleta de vagas, performance (uma chamada leve a `/key` por minuto, no máximo) e CSP (`https://openrouter.ai` já está em `cspHosts`).

## 5. Segurança e privacidade (resumo)
- Sem segredo novo. A chave continua só no navegador.
- `returnTo` com allowlist de caminhos internos, para não abrir redirecionamento aberto.
- A intenção no `sessionStorage` é limpa em qualquer desfecho, igual ao verifier.
- Consentimento explícito e reversível: "Desconectar" apaga `freeConsent`.
- Recomendo uma rodada da skill `seguranca` sobre o texto do consentimento (LGPD: transferência internacional e possível publicação) antes do release.

## 6. Testes
- **Unit:** `isFreeModel`; `providerOptions` omite `deny` só para modelos grátis; `listOpenRouter` marca `free`/`structured` e insere `openrouter/free` (fixture do `/models`); `completeOpenRouterAuth` devolve a intenção e limpa o storage; o callback com intenção "free" preenche só as tarefas `null`; mapeamento do 429 com `resetAt` e a mensagem diária vs. por minuto; `getOpenRouterFreeUsage` com e sem o campo; `NoProviderCta` mostra o botão grátis; filtro "Só gratuitos" no `TaskModelRow` (ajustar `tests/unit/client/task-model-row.test.tsx`).
- **E2E (`tests/e2e/settings.spec.ts`):** a rota do OpenRouter mockada; clicar em "Conectar e usar grátis" → consentimento → redirect com `code_challenge`; callback mockado → tarefas com `openrouter/free`.
- **Verificação:** `pnpm typecheck && pnpm lint`, `pnpm test`, e2e de settings e `pnpm build` (mexe em rota de callback).

## 7. Plano de entrega

| Fase | Entrega | Esforço |
|------|---------|---------|
| **0. Spike (manual, com conta grátis real)** | Confirmar: (1) `openrouter/free` + `require_parameters` + json_schema funciona nas 3 tarefas e a taxa de sucesso da extração; (2) quais toggles de privacidade são necessários e o texto do erro quando faltam; (3) se `deny` zera os grátis; (4) se o OAuth cria chave com saldo zero sem cartão. Registrar em `docs/tech/spikes.md`. | P |
| **1. Núcleo** | `isFreeModel`, `OPENROUTER_FREE_MODEL`, `providerOptions` (D-02), `freeConsent` + bloqueio, intenção no PKCE + callback + `returnTo` (D-03), proteção contra modelo pago (D-07). Testes unitários. | M |
| **2. UI de entrada** | Card destacado + faixa + `NoProviderCta` + hook compartilhado + diálogo de consentimento (D-03, D-04). E2E. | M |
| **3. Modelos e cota** | Filtro "Só gratuitos", `free`/`structured` no `listOpenRouter` (D-05), cota diária e mensagens do 429 (D-06), parágrafo em `/privacidade`. | M |

Caminho crítico: 0 → 1 → 2. A fase 3 depende só da 1 e pode rodar em paralelo à 2 (arquivos distintos, exceto `TaskModelRow`, que é só da 3).

## 8. Riscos

| Risco | Prob. | Impacto | Mitigação |
|-------|-------|---------|-----------|
| 50 usos/dia acabam rápido (importar CV + analisar várias vagas) | Alta | Médio | Cota visível (D-06), texto honesto ("cerca de 50 usos por dia"), análise sob demanda (já é assim) |
| `openrouter/free` sorteia modelo ruim para JSON | Média | Médio | Zod + `jsonrepair` já existem; o spike mede; plano B na D-01 |
| Conta sem os toggles de grátis → tudo falha | Alta | Alto | Mensagem com link e passo a passo (D-02); instrução já no diálogo de consentimento |
| Endpoint grátis publica o prompt com dados do CV | Média | Alto | Redação de PII já existe, consentimento explícito, alternativa paga/local |
| OpenRouter muda limites ou o roteador | Média | Baixo | Nada fixado além de `openrouter/free`; o número do limite vem da API |

## 9. Perguntas em aberto
1. Toggles exatos de privacidade necessários para os grátis (spike, Fase 0).
2. O OAuth cria chave em conta nova sem cartão? (spike) Se não, o texto precisa avisar.
3. O limite de 50/dia é por conta ou por chave? Não muda a implementação, só o texto.
