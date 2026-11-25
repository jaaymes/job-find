# Plano de implementação: redesign das Configurações de IA e seletor de modelo em modal

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** trocar o select de provedor + combobox de cada tarefa por um modal com busca que lista os modelos de todos os provedores conectados, do mais barato ao mais caro, e reorganizar a tela inteira de Configurações de IA.

**Arquitetura:** a camada de dados (`lib/client/ai/providers.ts`) passa a pedir ao OpenRouter só modelos de texto servidos por `chat/completions` e filtra modelos que não são de chat nos provedores estilo OpenAI. Um hook junta, com `useQueries`, os modelos de todos os provedores conectados. O `ModelPickerDialog` (Base UI Dialog) faz busca, filtros e ordenação por custo; o `TaskModelRow` vira um resumo com botão; o `AiSettingsScreen` muda a ordem das seções.

**Stack:** Next 16 (App Router), React 19.3, `@base-ui/react` 1.9, `@tanstack/react-query` 5, Tailwind 4 com tokens `jf-*`, Vitest + Testing Library, Playwright.

**Spec:** [docs/tech/2026-11-24-redesign-configuracoes-ia.md](../tech/2026-11-24-redesign-configuracoes-ia.md)

## Restrições globais

- Nenhuma dependência nova (nem virtualização, nem busca fuzzy).
- Nenhuma variável de ambiente nem feature flag: tudo já entra ativo.
- O formato salvo de `AiSettings.tasks` não muda: `{ provider: ProviderId; model: string } | null`.
- Textos visíveis em pt-BR; identificadores em inglês, como no resto do código.
- URL do OpenRouter: `${PROVIDERS_BASE.openrouter}/models?output_modalities=text&endpoints=/api/v1/chat/completions`.
- Modelo sem preço: nenhum texto de preço na tela; vai para o fim da lista, em ordem alfabética.
- **Não commitar, criar branch nem dar push sem pedido explícito do usuário.** Antes da Tarefa 5, o trabalho do OAuth não commitado em `ProviderCard.tsx` precisa estar resolvido (ver Riscos da spec).
- Verificação de cada tarefa: `pnpm typecheck && pnpm lint` e `pnpm test` (os testes citados). Na Tarefa 6, também `pnpm test:e2e tests/e2e/settings.spec.ts` e `pnpm build`.

## Foco da revisão

1. **Mesmo id em dois provedores** (ex.: `deepseek-chat` no DeepSeek e no OpenRouter): as duas linhas aparecem, a chave React não colide e escolher uma grava o provedor certo.
2. **Modelo salvo que a API não devolve mais** (saiu do catálogo ou foi filtrado por `isTextModelId`): continua na lista com o selo "Atual", sem preço.
3. **Um provedor falha e outro carrega:** a lista mostra os modelos do que carregou e uma linha de erro com "Tentar de novo" para o outro.
4. **Busca sem resultado:** mostra "Nenhum modelo encontrado" e a opção "Automático" continua disponível.
5. **Nenhum provedor conectado:** o botão "Trocar modelo" fica desabilitado e a seção de provedores vem antes das tarefas.

---

### Task 1: catálogo de texto do OpenRouter e filtro de modelos de chat

**Arquivos:**
- Modificar: `lib/client/ai/providers.ts` (`listOpenRouter` ~linha 217, `listOpenAIStyle` ~linha 206)
- Testar: `tests/unit/client/ai/providers.test.ts`

**Interfaces:**
- Produz: `export function isTextModelId(id: string): boolean` em `providers.ts`.

- [ ] **Passo 1: escrever os testes que falham**

```ts
it("OpenRouter pede só modelos de texto servidos por chat/completions", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await PROVIDERS.openrouter.listModels({ apiKey: "k" });
  expect(String(fetchMock.mock.calls[0][0])).toBe(
    "https://openrouter.ai/api/v1/models?output_modalities=text&endpoints=/api/v1/chat/completions",
  );
});

it("OpenRouter: resposta vazia com os filtros cai para a lista sem filtros, sem as variantes :batch", async () => {
  // 1ª chamada devolve { data: [] }; 2ª devolve a/x e a/x:batch
  // espera: uma lista só com "a/x" e a 2ª URL sem query string
});

it.each(["text-embedding-3-small", "whisper-1", "tts-1-hd", "gpt-4o-transcribe", "dall-e-3", "gpt-image-1",
  "omni-moderation-latest", "gpt-4o-audio-preview", "gpt-4o-realtime-preview", "llama-guard-4", "rerank-v3"])(
  "isTextModelId(%s) é false", (id) => expect(isTextModelId(id)).toBe(false));

it.each(["gpt-5-mini", "llama-3.3-70b-versatile", "mistral-large-latest", "grok-4", "deepseek-chat"])(
  "isTextModelId(%s) é true", (id) => expect(isTextModelId(id)).toBe(true));

it("listOpenAIStyle descarta modelos que não são de chat", async () => {
  // stub { data: [{ id: "gpt-5-mini" }, { id: "whisper-1" }] } → PROVIDERS.openai.listModels devolve só gpt-5-mini
});
```

- [ ] **Passo 2:** `pnpm test tests/unit/client/ai/providers.test.ts` → FALHA (`isTextModelId` não existe, URL sem query).
- [ ] **Passo 3: implementar.** `isTextModelId` com uma regex só: `/(embed|whisper|tts|transcribe|dall-e|gpt-image|moderation|rerank|-audio|realtime|guard)/i`, negada. `listOpenAIStyle` aplica o filtro. `listOpenRouter` usa a URL das restrições globais; se `data` vier vazio, repete sem query e descarta `id.endsWith(":batch")`.
- [ ] **Passo 4:** mesmo comando → PASSA. `pnpm typecheck && pnpm lint` limpos.

### Task 2: textos de preço sem "sem preço"

**Arquivos:**
- Modificar: `components/settings/cost.ts`
- Testar: `tests/unit/components/settings-cost.test.ts:34-57`

**Interfaces:**
- Produz: `priceLabel(task, model): string` (devolve `""` sem preço); `estimateCost(task, model): string | undefined` (devolve `undefined` sem preço). `sortModelsByCost` não muda.

- [ ] **Passo 1: ajustar os testes**

```ts
expect(priceLabel("extract", { id: "z", label: "Z" })).toBe("");
expect(estimateCost("cv", {})).toBeUndefined();
expect(estimateCost("cv", undefined)).toBeUndefined();
it("ordena modelos de provedores diferentes juntos: grátis, mais barato, mais caro, sem preço em ordem alfabética", () => {
  // entradas: { id:"b", label:"Beta" } sem preço, { id:"a", label:"Alfa" } sem preço, caro (5/15), barato (0.1/0.4), grátis (0/0)
  // espera ids: ["gratis", "barato", "caro", "a", "b"]
});
```

- [ ] **Passo 2:** `pnpm test tests/unit/components/settings-cost.test.ts` → FALHA.
- [ ] **Passo 3:** mudar os dois retornos de "sem preço". O `TaskModelRow` atual ainda compila (será reescrito na Tarefa 4); se o typecheck reclamar do `string | undefined`, usar `?? ""` provisório.
- [ ] **Passo 4:** mesmo comando → PASSA; typecheck limpo.

### Task 3: busca compartilhada e hook dos modelos conectados

**Arquivos:**
- Criar: `components/settings/model-search.ts`, `components/settings/use-connected-models.ts`
- Modificar: `components/settings/TaskModelRow.tsx` (remover `fold`/`matchesModel` e importar de `model-search.ts`)
- Testar: `tests/unit/components/model-search.test.ts`, `tests/unit/client/use-connected-models.test.tsx`

**Interfaces:**
- Produz:
  - `export type ModelOption = ModelInfo & { provider: ProviderId }`
  - `export function matchesModel(model: ModelOption, query: string, providerLabel: string): boolean` (busca em `label`, `id` e nome do provedor, sem acento e sem caixa)
  - `export function optionKey(o: ModelOption): string` → `` `${o.provider}:${o.id}` ``
  - `export function useConnectedModels(settings: AiSettings, enabled: boolean): { options: ModelOption[]; states: { provider: ProviderId; status: "pending" | "error" | "success"; refetch: () => void }[] }`
- Regras do hook: `useQueries`, uma query por provedor de `PROVIDER_IDS.filter((id) => isConnected(settings, id))`, `queryKey: ["ai-models", id, cfg.addedAt]` (a mesma de hoje), `staleTime: 30 * 60_000`, `retry: false`, `enabled`. Para cada provedor conectado, injeta o modelo salvo em qualquer tarefa e os `defaultModels` se a API não os devolveu (`{ id, label: id }`).

- [ ] **Passo 1: testes que falham**
  - `matchesModel`: "gemini" acha "Gêmini Flash"; "openrouter" acha qualquer modelo do OpenRouter pelo nome do provedor; query só com espaços acha tudo.
  - `useConnectedModels` (com `renderHook` e `QueryClientProvider`, `fetch` mockado por URL): dois provedores conectados (OpenRouter e DeepSeek) com o mesmo id `deepseek-chat` → duas opções com `optionKey` diferentes; OpenRouter com 500 e DeepSeek com 200 → `states` traz `error` para um e `success` para o outro, e `options` tem os do DeepSeek; tarefa salva com `{ provider: "openrouter", model: "x/sumiu" }` que a API não devolve → `options` inclui `x/sumiu`; `enabled: false` → nenhum `fetch`.
- [ ] **Passo 2:** `pnpm test tests/unit/components/model-search.test.ts tests/unit/client/use-connected-models.test.tsx` → FALHA.
- [ ] **Passo 3:** implementar os dois arquivos e trocar o import no `TaskModelRow`.
- [ ] **Passo 4:** os mesmos testes + `tests/unit/client/task-model-row.test.tsx` → PASSAM.

### Task 4: `ModelPickerDialog` e `TaskModelRow` como resumo

**Arquivos:**
- Criar: `components/settings/ModelPickerDialog.tsx`
- Reescrever: `components/settings/TaskModelRow.tsx`
- Testar: `tests/unit/client/model-picker-dialog.test.tsx` (novo), `tests/unit/client/task-model-row.test.tsx` (reescrito)

**Interfaces:**
- Consome: `useConnectedModels`, `matchesModel`, `optionKey`, `ModelOption` (Tarefa 3); `sortModelsByCost`, `priceLabel`, `estimateCost` (Tarefa 2); `isFreeModel`, `PROVIDERS` (`providers.ts`).
- Produz:
  - `ModelPickerDialog({ task, settings, open, onOpenChange, onSelect }: { task: AiTask; settings: AiSettings; open: boolean; onOpenChange: (open: boolean) => void; onSelect: (choice: { provider: ProviderId; model: string } | null) => void })`
  - `TaskModelRow` mantém as props atuais `{ task, settings, onChange }`.

**Comportamento fixado pela spec (D-03):**
- Título: `Modelo para {TASK_COPY[task].name}`; descrição: `TASK_COPY[task].desc`.
- Campo de busca com rótulo "Buscar modelo", foco ao abrir; filtro com `useDeferredValue`.
- Chips (botões com `aria-pressed`): "Todos", um por provedor conectado (`{label} ({n})`) e "Só gratuitos" (custo 0 em `operationCost`). "Só gratuitos" já vem ligado quando o modelo atual é grátis.
- Primeira opção fixa: "Automático (primeiro provedor conectado, modelo recomendado)" → `onSelect(null)`.
- Lista ordenada por `sortModelsByCost(task, …)`; linha = nome, provedor, id secundário, `priceLabel` (só se não for `""`), selos "Atual", "Recomendado" (`PROVIDERS[p].defaultModels[task]`) e "Grátis". Linhas com `content-visibility: auto`.
- Teclado: tentar `Combobox` do Base UI inline (sem `ComboboxPopup`/portal) dentro do `DialogContent`; confirmar no Context7 (`@base-ui/react` combobox, uso inline). Se não for suportado, `role="listbox"` com `aria-activedescendant`, setas/Home/End movem, Enter escolhe.
- Erro de provedor: linha "Não foi possível carregar os modelos de {label}." com botão "Tentar de novo" (`refetch`). Carregando: "Carregando modelos de {label}…".
- Vazio: "Nenhum modelo encontrado".
- Esc e "Cancelar" fecham sem chamar `onSelect`.
- `TaskModelRow`: nome e descrição da tarefa; modelo atual ("Automático" ou `{label} · {provedor}`); custo (`estimateCost`, só se definido); botão "Trocar modelo" (desabilitado sem provedor conectado) que abre o modal. Mantém o aviso de provedor desconectado (texto atual, `role="alert"`) e o aviso de modelo grátis (texto atual, `role="note"`).

- [ ] **Passo 1: testes que falham** (`model-picker-dialog.test.tsx`, usando `MODELS` de `task-model-row.test.tsx` e um segundo provedor mockado)
  - abre com o foco no campo "Buscar modelo";
  - a ordem dos nomes é grátis → mais barato → mais caro → "Outro Modelo" (sem preço) no fim, e a linha de "Outro Modelo" não contém "US$" nem "sem preço";
  - digitar "gemini" deixa só "Gêmini Flash"; digitar "zzz" mostra "Nenhum modelo encontrado" e "Automático" segue visível;
  - chip "DeepSeek" mostra só os do DeepSeek; chip "Só gratuitos" mostra só os de custo 0;
  - clicar em "DeepSeek Flash" chama `onSelect({ provider: "openrouter", model: "deepseek/deepseek-v4.1-flash" })`; clicar em "Automático" chama `onSelect(null)`;
  - mesmo id em dois provedores: escolher a linha do DeepSeek grava `provider: "deepseek"`;
  - OpenRouter com 500: aparece "Não foi possível carregar os modelos de OpenRouter." e os do DeepSeek continuam;
  - Esc fecha sem `onSelect`.
- [ ] **Passo 2: reescrever `task-model-row.test.tsx`**: provedor desconectado mostra o aviso; sem provedor conectado o botão "Trocar modelo" está desabilitado; escolha salva mostra `Claude Haiku · OpenRouter` e o custo; modelo sem preço não mostra custo; modelo `:free` mostra o aviso de gratuitos.
- [ ] **Passo 3:** `pnpm test tests/unit/client/model-picker-dialog.test.tsx tests/unit/client/task-model-row.test.tsx` → FALHA.
- [ ] **Passo 4:** implementar.
- [ ] **Passo 5:** mesmo comando → PASSA; `pnpm typecheck && pnpm lint` limpos.

### Task 5: nova estrutura da tela (skill `impeccable`)

**Pré-requisito:** mudanças não commitadas do OAuth em `ProviderCard.tsx` resolvidas (commit pelo usuário ou branch nova).

**Arquivos:**
- Modificar: `components/settings/AiSettingsScreen.tsx`, `components/settings/ProviderCard.tsx`
- Testar: `tests/unit/client/provider-card.test.tsx`, novo `tests/unit/client/ai-settings-screen.test.tsx`

**Interfaces:**
- Consome: `TaskModelRow` (Tarefa 4).
- Produz: `ProviderCard` com a prop nova `variant?: "card" | "compact"` (padrão `"card"`).

**Estrutura fixada pela spec (D-05):**
1. Cabeçalho: título, texto atual sobre as chaves e a linha de estado `"{n} provedor(es) conectado(s)"` ou `"Nenhuma IA conectada"`.
2. Com ≥ 1 conectado: "Modelo para cada tarefa" vem primeiro. Com 0: "Provedores" vem primeiro.
3. "Provedores": conectados em lista com `variant="compact"` (nome, forma de conexão, Testar, Remover, revisar aviso); não conectados em grade (`must`) + `<details>` "Mais provedores ({n})" com os `should` não conectados.
4. "Privacidade" e `BackupSection` lado a lado, como hoje.

- [ ] **Passo 1:** invocar a skill `impeccable` com a spec D-05 e a tela atual; o visual usa só tokens `jf-*` existentes.
- [ ] **Passo 2: testes que falham** em `ai-settings-screen.test.tsx`: sem provedor → o heading "Provedores" aparece antes de "Modelo para cada tarefa" e o estado diz "Nenhuma IA conectada"; com OpenRouter conectado → ordem invertida, estado "1 provedor conectado", e o OpenRouter aparece na lista compacta e não na grade. Em `provider-card.test.tsx`: `variant="compact"` mostra Testar e Remover e não mostra a descrição longa.
- [ ] **Passo 3:** `pnpm test tests/unit/client/ai-settings-screen.test.tsx tests/unit/client/provider-card.test.tsx` → FALHA.
- [ ] **Passo 4:** implementar.
- [ ] **Passo 5:** mesmo comando → PASSA; `pnpm typecheck && pnpm lint` limpos.

### Task 6: E2E e verificação completa

**Arquivos:**
- Modificar: `tests/e2e/settings.spec.ts` (testes das linhas 252 e 278; novo teste de ordenação)

- [ ] **Passo 1:** reescrever "modelo por tarefa…" (linha 252): conectar OpenRouter com `/models` mockado, clicar em "Trocar modelo" de "Gerar CV e carta", buscar, escolher, recarregar e conferir o resumo da linha.
- [ ] **Passo 2:** ajustar "modelo gratuito (:free)…" (linha 278) para escolher pelo modal.
- [ ] **Passo 3:** novo teste "o modal lista do mais barato ao mais caro e o modelo sem preço no fim, sem texto de preço", com `route` para `**/api/v1/models?**`.
- [ ] **Passo 4:** `pnpm test:e2e tests/e2e/settings.spec.ts` → PASSA (incluindo o teste de CSP da linha 337).
- [ ] **Passo 5:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build` → tudo verde. Conferir no navegador (`/configuracoes`, desktop e 375 px) que a digitação na busca não trava com o catálogo real.

## Dependências e paralelismo

| Tarefa | Depende de | Pode rodar em paralelo com |
|--------|------------|----------------------------|
| 1 | — | 2 |
| 2 | — | 1 |
| 3 | — | 1, 2 |
| 4 | 2, 3 | — |
| 5 | 4 (e o pré-requisito do OAuth) | 6, passos 1–3 |
| 6 | 4, 5 | — |
