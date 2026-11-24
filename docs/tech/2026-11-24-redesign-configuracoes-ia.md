# Spec técnica: redesign da tela de Configurações de IA e seletor de modelo em modal

- **Data:** 2026-11-24
- **Origem:** pedido do usuário na conversa, sem PRD próprio. PRD base: [docs/prd/2026-11-23-job-find-agregador-vagas-tech.md](../prd/2026-11-23-job-find-agregador-vagas-tech.md)
- **Specs relacionadas:** [2026-11-24-openrouter-gratuito.md](2026-11-24-openrouter-gratuito.md) (D-05, filtro "Só gratuitos"), [2026-11-24-oauth-provedores-ia.md](2026-11-24-oauth-provedores-ia.md), [2026-11-24-ajustes-importacao-modelos-tema.md](2026-11-24-ajustes-importacao-modelos-tema.md)
- **Pesquisa:** documentação oficial do OpenRouter (Context7, `/websites/openrouter_ai`) e chamadas reais a `GET https://openrouter.ai/api/v1/models` feitas em 2026-11-24

## 1. Requisitos (premissas registradas a partir do pedido)

| ID | Requisito |
|----|-----------|
| RF-01 | Repensar e refazer o design da tela inteira de Configurações de IA (decisão do usuário: tela inteira, não só a seção de modelos). |
| RF-02 | Escolher o modelo de uma tarefa abre um **modal** com um campo de busca. |
| RF-03 | O modal mostra os modelos de **todos os provedores conectados**, não só do OpenRouter. O provedor é escolhido no próprio modal (decisão do usuário): some o select separado de "Provedor". |
| RF-04 | Do OpenRouter, mostrar **todos os modelos de texto** (decisão do usuário: "só texto"; modelos de imagem, áudio e embeddings ficam de fora porque não servem para as 3 tarefas). |
| RF-05 | Ordenar do **mais barato ao mais caro**. |
| RF-06 | Modelo sem preço informado: aparece só com o nome, sem texto de preço, no fim da lista. |
| RNF-01 | Abrir o modal e filtrar 400–600 modelos sem travar a digitação. |
| RNF-02 | Acessível por teclado e leitor de tela (foco preso no modal, setas na lista, Esc fecha). |
| Fora | Nova dependência (virtualização, busca fuzzy), variáveis de ambiente ou feature flags (regra do projeto), mudança no formato salvo de `AiSettings`. |

## 2. O que já existe (fatos do código)

- A tela é `components/settings/AiSettingsScreen.tsx` (215 linhas): título, grade de `ProviderCard` (tier `must` + `<details>` com os `should`), seção "Modelo para cada tarefa" com 3 `TaskModelRow`, e uma linha com "Privacidade" + `BackupSection`.
- `TaskModelRow` (`components/settings/TaskModelRow.tsx`) tem um `<select>` de provedor (linhas 96–117) e um `Combobox` do Base UI para o modelo (linhas 123–152). Já tem busca sem acento (`fold`/`matchesModel`, linhas 23–30), trata provedor desconectado (`stale`, linha 59) e o aviso de modelo grátis (linha 169).
- Os modelos vêm de `PROVIDERS[id].listModels` via React Query, `staleTime` de 5 min, um provedor por vez (`useModels`, linhas 39–48).
- `components/settings/cost.ts` já tem `operationCost`, `sortModelsByCost` (grátis primeiro, mais barato ao mais caro, sem preço no fim) e `priceLabel` (hoje devolve `"sem preço"`) e `estimateCost` (hoje devolve `"custo não informado pelo provedor"`).
- `ModelInfo = { id, label, priceIn?, priceOut? }` (`lib/client/ai/providers.ts:32`).
- Só três provedores informam preço: OpenRouter (`listOpenRouter`, `providers.ts:217`), Together e Vercel AI Gateway. Os demais (`listOpenAIStyle`, Anthropic, Google) não trazem preço.
- `listOpenRouter` chama `GET /api/v1/models` **sem parâmetros** (`providers.ts:218`).
- `listOpenAIStyle` devolve tudo o que `/models` lista, sem filtrar tipo (na OpenAI, isso inclui embeddings, whisper, tts e imagem). O Google já filtra por `generateContent` (`providers.ts:255`).
- Diálogos: `components/ui/dialog.tsx` (Base UI), já usado em `AddKeyDialog`, `PrivacyConsentDialog` e `ImportProgressDialog`.
- O filtro "Só gratuitos" da spec do OpenRouter grátis (D-05) **não foi implementado**: `ModelInfo` não tem `free` nem `structured`.
- Testes atuais: `tests/unit/client/task-model-row.test.tsx`, `tests/unit/client/provider-card.test.tsx` e `tests/e2e/settings.spec.ts` (o teste "modelo por tarefa: provedor e modelo de Gerar CV e carta persistem após recarregar", linha 252, usa o select e o combobox atuais).

## 3. Fatos do catálogo do OpenRouter (medidos em 2026-11-24)

| Consulta | Modelos | Grátis | Tamanho |
|----------|---------|--------|---------|
| `/models` (padrão: `output_modalities=text`) | 470 | 14 | ~910 KB |
| `/models?output_modalities=all` | 732 | 110 | ~1,2 MB |
| `/models?output_modalities=text&endpoints=/api/v1/chat/completions` | 378 | 14 | ~700 KB |

- Os 92 modelos de texto que **não** servem `/api/v1/chat/completions` são todos variantes `:batch` (ex.: `anthropic/claude-haiku-5.5:batch`), que só funcionam pela API de lotes. Como têm desconto, apareceriam **no topo** da lista "mais barato" e falhariam ao serem usados, porque o `@openrouter/ai-sdk-provider` chama `chat/completions`.
- A API aceita `sort=pricing-low-to-high`, mas ordena só pelo preço de entrada. A ordenação local por custo da operação (entrada + saída, por tarefa) é mais fiel.
- Roteadores dinâmicos (ex.: `openrouter/auto`) têm preço `-1`. `perMillion` já trata negativo como "sem preço" (`providers.ts:147`), então eles vão para o fim. `openrouter/free` tem preço 0 e fica no topo.

## 4. Decisões

### D-01: o que é "todos os modelos" do OpenRouter (RF-04)
- **Contexto:** o usuário quer o catálogo completo, só de texto. Hoje a chamada já devolve texto (padrão da API), mas inclui as variantes `:batch`, que quebram.
- **Opções:** (a) manter `/models` sem parâmetros (470, com 92 que falham); (b) `output_modalities=text&endpoints=/api/v1/chat/completions` (378, todos utilizáveis); (c) `output_modalities=all` (732).
- **Decisão:** (b). São todos os modelos de texto que o app consegue de fato chamar. Os parâmetros ficam explícitos na URL, para não depender do padrão da API.
- **Por que não (a):** os `:batch` ficariam no topo da lista "mais barato" e dariam erro. **Por que não (c):** descartado pelo usuário.
- **Consequências:** a lista do OpenRouter fica com ~378 modelos. Se a API mudar e a resposta vier vazia com os parâmetros, cair para a chamada sem parâmetros e filtrar `id.endsWith(":batch")` no cliente.

### D-02: modelos que não geram texto nos outros provedores (RF-04)
- **Contexto:** `listOpenAIStyle` não traz tipo de modelo. Na OpenAI, a lista inclui embeddings, transcrição, voz, imagem e moderação, que não servem para as tarefas.
- **Opções:** (a) mostrar tudo; (b) heurística por id para esconder os que claramente não são de chat; (c) lista fixa de modelos por provedor.
- **Decisão:** (b). Função pura `isTextModelId(id)` em `providers.ts`, aplicada em `listOpenAIStyle`, que descarta ids com `embed`, `whisper`, `tts`, `transcribe`, `dall-e`, `gpt-image`, `moderation`, `rerank`, `-audio`, `realtime` e `guard`.
- **Por que não (c):** fica velha a cada lançamento.
- **Consequências:** risco de esconder um modelo útil por falso positivo. Mitigação: lista curta e testada; o modelo salvo continua aparecendo mesmo se for filtrado (ver D-04).

### D-03: modal `ModelPickerDialog` (RF-02, RF-03, RF-05, RF-06)
- **Contexto:** a escolha hoje exige dois controles (provedor + modelo) e um combobox estreito, ruim para centenas de itens.
- **Decisão:** novo componente `components/settings/ModelPickerDialog.tsx`, aberto por um botão em cada tarefa.
  - **Cabeçalho:** "Modelo para {nome da tarefa}" + descrição curta da tarefa.
  - **Busca:** `<input type="search">` com foco ao abrir. Reaproveita `fold`/`matchesModel` (movidos para `components/settings/model-search.ts`), buscando também no nome do provedor.
  - **Filtros:** chips de provedor ("Todos" + um por provedor conectado, com contagem) e o chip "Só gratuitos" (cumpre o D-05 da spec do OpenRouter grátis de forma genérica: grátis = custo 0, em qualquer provedor).
  - **Opção fixa no topo:** "Automático (primeiro provedor conectado, modelo recomendado)", que grava `null`.
  - **Lista:** modelos de todos os provedores conectados juntos, ordenados por `sortModelsByCost(task, …)`. Cada linha mostra nome, provedor, id (texto secundário), preço por operação e selos "Atual", "Recomendado" e "Grátis". Modelo sem preço não mostra texto de preço (RF-06).
  - **Seleção:** clique ou Enter grava `{ provider, model }` e fecha o modal. Esc ou "Cancelar" fecham sem salvar.
  - **Carregamento:** um estado por provedor. Enquanto um carrega, os outros já aparecem; erro de um provedor vira uma linha "Não foi possível carregar os modelos de X" com "Tentar de novo", sem bloquear a lista.
- **Opções avaliadas para a lista com teclado:** (a) reaproveitar o `Combobox` do Base UI dentro do diálogo, sempre aberto e sem popup; (b) `role="listbox"` próprio com `aria-activedescendant`.
- **Decisão:** (a) se o Base UI 1.9 aceitar a lista inline sem portal (verificar na Fase 2, com Context7); senão (b). As duas opções não precisam de dependência nova.
- **Consequências:** o `TaskModelRow` deixa de ter select e combobox e vira um resumo com botão (D-05).

### D-04: dados juntos de vários provedores
- **Decisão:** hook `useConnectedModels(settings)` em `components/settings/`, com `useQueries` (um por provedor conectado), mesma `queryKey` de hoje (`["ai-models", id, addedAt]`) para aproveitar o cache. Devolve `ModelOption[]` (`ModelInfo & { provider: ProviderId }`) mais o estado de cada provedor.
- As queries só rodam quando o modal abre pela primeira vez (`enabled` ligado na abertura) e ficam em cache por 30 min (`staleTime`), porque a resposta do OpenRouter tem ~700 KB.
- O modelo salvo e o recomendado de cada provedor entram na lista mesmo que a API não os devolva (mesma regra das linhas 69–71 de hoje).
- A chave de cada linha é `${provider}:${id}`, porque o mesmo id pode existir em dois provedores.

### D-05: nova estrutura da tela (RF-01)
- **Contexto:** hoje a página abre com 14 cards de provedor, e a escolha de modelo, que é o que a pessoa mais ajusta depois de conectar, fica no meio.
- **Decisão (ordem das seções):**
  1. **Cabeçalho:** título, o texto atual sobre chaves locais e uma linha de estado: "N provedores conectados" ou "Nenhuma IA conectada".
  2. **Modelo para cada tarefa** (primeiro, quando há pelo menos 1 provedor conectado): 3 linhas, cada uma com nome e descrição da tarefa, o modelo atual ("Automático", ou nome do modelo + provedor), custo por operação (só se houver preço) e o botão "Trocar modelo", que abre o modal. Os avisos de provedor desconectado e de modelo grátis continuam na linha.
  3. **Provedores:** os conectados em uma lista compacta (nome, forma de conexão, Testar, Remover); os não conectados em grade, com "Mais provedores" recolhível como hoje. Sem nenhum conectado, esta seção vem **antes** das tarefas.
  4. **Privacidade** e **Backup**, lado a lado como hoje.
- O visual (espaçamento, hierarquia, estados vazios, textos) é feito na execução com a skill `impeccable`, usando os tokens `jf-*` existentes.
- **Consequências:** `ProviderCard` ganha uma variante compacta para conectado. Ele tem mudanças **não commitadas** do OAuth nesta branch (ver Riscos).

### D-06: textos de preço (RF-06)
- `priceLabel` devolve `""` quando não há preço (hoje `"sem preço"`), e a linha não renderiza o texto vazio.
- `estimateCost` devolve `undefined` em vez de `"custo não informado pelo provedor"`, e a tela só mostra o custo quando há valor.
- A ordem continua igual: grátis, mais barato ao mais caro, sem preço no fim em ordem alfabética.

### Eixos sem impacto
Dados no servidor e migrações (o formato de `AiSettings.tasks` não muda), APIs do back-end, segurança (nenhuma superfície nova: as chamadas a `/models` já existem e a chave continua só no navegador; CSP já libera os hosts), coleta de vagas.

## 5. Performance (RNF-01)
- ~378 modelos do OpenRouter + algumas dezenas dos outros: até ~600 linhas. Renderizar tudo sem virtualização é aceitável; usar `content-visibility: auto` nas linhas e `useDeferredValue` na busca. Se a digitação travar em celular médio, limitar a 200 linhas renderizadas com "Mostrar mais" antes de pensar em dependência nova.
- A ordenação roda uma vez por (tarefa, dados), com `useMemo`; a busca só filtra.

## 6. Testes
- **Unit:**
  - `listOpenRouter` chama a URL com `output_modalities=text&endpoints=/api/v1/chat/completions` (fixture).
  - `isTextModelId` com casos da OpenAI (positivos e negativos).
  - `priceLabel`/`estimateCost` sem preço; `sortModelsByCost` com vários provedores.
  - `ModelPickerDialog` (novo `tests/unit/client/model-picker-dialog.test.tsx`): busca sem acento, filtro por provedor, "Só gratuitos", ordem por custo, linha sem preço sem texto de preço, escolher grava `{ provider, model }`, "Automático" grava `null`, erro de um provedor não esconde os outros, Esc não salva.
  - Reescrever `task-model-row.test.tsx` para o resumo + botão.
- **E2E (`tests/e2e/settings.spec.ts`):** reescrever o teste da linha 252 (abrir o modal, buscar, escolher, recarregar e conferir) e o da linha 278 (aviso de modelo `:free`); novo teste com `/models` mockado conferindo a ordem do mais barato ao mais caro e um modelo sem preço no fim.
- **Verificação:** `pnpm typecheck && pnpm lint`, `pnpm test`, e2e de settings e `pnpm build`.

## 7. Plano de entrega

| Fase | Entrega | Arquivos | Esforço |
|------|---------|----------|---------|
| 1 | Dados: parâmetros do OpenRouter (D-01), `isTextModelId` (D-02), textos de preço (D-06), `useConnectedModels` (D-04) | `lib/client/ai/providers.ts`, `components/settings/cost.ts`, `components/settings/use-connected-models.ts`, `model-search.ts` + testes | P |
| 2 | `ModelPickerDialog` (D-03) e `TaskModelRow` como resumo + botão | `components/settings/ModelPickerDialog.tsx`, `TaskModelRow.tsx` + testes | M |
| 3 | Nova estrutura da tela com a skill `impeccable` (D-05) | `AiSettingsScreen.tsx`, `ProviderCard.tsx` + testes | M |
| 4 | E2E e verificação completa | `tests/e2e/settings.spec.ts` | P |

Caminho crítico: 1 → 2 → 4. A fase 3 depende só da 2 (usa o novo `TaskModelRow`) e pode correr em paralelo com a parte de E2E do modal.

## 8. Riscos

| Risco | Prob. | Impacto | Mitigação |
|-------|-------|---------|-----------|
| A branch `feat/oauth-provedores` tem mudanças não commitadas em `ProviderCard.tsx` e testes, que o redesign também toca | Alta | Médio | Commitar o trabalho do OAuth antes de começar, ou fazer o redesign em outra branch a partir dele |
| Heurística de D-02 esconde um modelo útil | Baixa | Baixo | Lista curta e testada; o modelo salvo sempre aparece |
| Base UI não aceita Combobox inline no diálogo | Média | Baixo | `listbox` próprio (D-03, opção b) |
| Catálogo do OpenRouter muda o comportamento dos parâmetros | Baixa | Médio | Fallback sem parâmetros + filtro `:batch` (D-01) |
| Lista longa trava em celular | Baixa | Médio | `content-visibility`, `useDeferredValue`, "Mostrar mais" |

## 9. Perguntas em aberto
- Nenhuma que bloqueie. As três decisões de produto (catálogo só de texto, provedor dentro do modal, redesign da tela inteira) foram respondidas pelo usuário em 2026-11-24.
