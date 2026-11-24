# Ajustes de importação, seletor de modelos e tema — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** importar o PDF do LinkedIn sem truncar, tornar o campo Modelo pesquisável e ordenado por preço, e adicionar tema claro/escuro.

**Arquitetura:** o orçamento de saída da extração e os parâmetros de raciocínio ficam em `lib/client/ai/generate.ts`. A ordenação e o preço são funções puras em `components/settings/cost.ts`, consumidas por um `Combobox` do Base UI no `TaskModelRow`. O tema usa um provider próprio, sem `next-themes`, mais um script inline de conteúdo fixo liberado por hash só na CSP com nonce.

**Stack:** Next 16.4 (App Router), React 19.3, Tailwind 4, `@base-ui/react` 1.9, AI SDK 7, Vitest (jsdom), Playwright.

**Spec:** [docs/tech/2026-11-24-ajustes-importacao-modelos-tema.md](../tech/2026-11-24-ajustes-importacao-modelos-tema.md)

## Restrições globais

- Nenhuma dependência nova. O `next-themes` **sai** do `package.json` (Task 8).
- Nenhuma variável de ambiente ou feature flag nova: tudo já entra ativo.
- Texto visível em pt-BR com acentuação correta; identificadores em inglês, como no resto do código.
- Preço só do **próprio provedor** (decisão do usuário). Nada de catálogo de terceiros.
- Fonte LinkedIn fora de escopo.
- **Hash do script de tema só em `buildNonceCsp`.** Na CSP pública (`buildCsp`), um hash faria o navegador ignorar `'unsafe-inline'` e quebraria a hidratação das páginas estáticas. Lá o script inline já é permitido por `'unsafe-inline'`.
- O PDF do CV (`lib/client/pdf/*`) continua com as cores claras.
- Verificação por tarefa: `pnpm typecheck && pnpm lint && pnpm test`. Tasks 7 e 8 também: `pnpm build` e `pnpm test:e2e tests/e2e/theme.spec.ts tests/e2e/csp-local.spec.ts`.
- Não fazer commit sem pedido do usuário (`CLAUDE.md`). Os passos "Commit" valem só se o usuário autorizar commits nesta execução.

## Foco de revisão

1. Modelo sem preço com o mesmo rótulo de outro: o empate tem que ser estável (rótulo, depois id) para a lista não "pular". Teste na Task 4.
2. Busca com acento ou caixa diferente ("gêmini", "CLAUDE") tem que achar o modelo. Teste na Task 5.
3. `localStorage` bloqueado (aba anônima ou cookies desligados) não pode quebrar o tema: cai no tema do sistema. Teste na Task 6.
4. Modelo salvo que sumiu da lista do provedor continua aparecendo e selecionado no combobox (hoje entra por `unshift`). Teste na Task 5.
5. Navegar para uma rota `(local)` com tema escuro salvo não pode piscar claro nem gerar violação de CSP. Teste e2e na Task 8.

## Mapa de paralelismo

| Fase | Tasks | Dependências |
|------|-------|--------------|
| 1 — Importação | 1, 2 | 2 depois de 1 (mesmo fluxo de teste) |
| 2 — Modelos | 3, 4, 5 | 3 e 4 em paralelo; 5 depois de 3 e 4. A 4 depois da 2 (`cost.ts`) |
| 3 — Tema | 6, 7, 8 | 6 e 7 em paralelo; 8 depois de 6 e 7 |

As fases 1 e 3 são independentes entre si. A fase 2 só depende da fase 1 por causa do `cost.ts`.

---

## Fase 1 — Importação do CV

### Task 1: Raciocínio mínimo na extração

**Arquivos:**
- Modificar: `lib/client/ai/generate.ts:43-56` (`providerOptions`) e a chamada em `callOnce` (`generate.ts:94`)
- Teste: `tests/unit/client/ai/generate.test.ts`

**Interfaces:**
- Produz: `providerOptions(def: ProviderDef, settings: AiSettings, task: AiTask)` (função interna, ganha o parâmetro `task`).

- [ ] **Passo 1: Escrever os testes que falham** (no padrão dos testes "OpenRouter envia…" existentes, lendo `model.doStreamCalls[0]?.providerOptions`)

```ts
it("extract na OpenAI pede reasoningEffort low", async () => {
  // settings com task extract -> provider openai
  expect(opts.openai).toEqual({ reasoningEffort: "low" });
});
it("extract no Google limita o thinkingBudget a 128", async () => {
  expect(opts.google).toEqual({ thinkingConfig: { thinkingBudget: 128 } });
});
it("analyze na OpenAI não mexe no raciocínio", async () => {
  expect(opts?.openai).toBeUndefined();
});
it("OpenRouter mantém reasoning low e require_parameters em qualquer tarefa", async () => {
  expect(opts.openrouter.reasoning).toEqual({ effort: "low" });
});
```

- [ ] **Passo 2:** `pnpm vitest run tests/unit/client/ai/generate.test.ts` → os 3 primeiros FALHAM.
- [ ] **Passo 3: Implementar.** Para `task === "extract"`: `openai: { reasoningEffort: "low" }` (`"minimal"` não vale nos modelos o-series) e `google: { thinkingConfig: { thinkingBudget: 128 } }` (128 é o mínimo aceito pelo 2.5 Pro e vale no Flash). O bloco do OpenRouter fica como está. Os demais provedores ficam sem opção. Devolver `undefined` quando não houver nada.
- [ ] **Passo 4:** mesmo comando → PASSA, e o arquivo inteiro continua verde.
- [ ] **Passo 5: Commit** `fix(ai): limita o raciocínio na leitura do currículo`

### Task 2: Teto de saída e mensagem de corte

**Arquivos:**
- Modificar: `lib/client/ai/prompts/profile.extract.v1.ts:30`, `components/settings/cost.ts:5` (`USAGE.extract.tokensOut`), `components/profile/messages.ts:30`
- Teste: `tests/unit/client/profile-import.test.ts`, `tests/unit/components/settings-cost.test.ts`

- [ ] **Passo 1: Testes que falham**

```ts
// profile-import.test.ts
it("a extração pede até 16000 tokens de saída", () => {
  expect(PROFILE_EXTRACT_V1.maxOutputTokens).toBe(16000);
});
// settings-cost.test.ts: o caso existente de "extract" passa a usar tokensOut 3000
// (ex.: priceIn 1, priceOut 2 -> (4000*1 + 3000*2)/1e6 = 0,0100 -> "≈ US$ 0,01 por currículo")
```

- [ ] **Passo 2:** `pnpm vitest run tests/unit/client/profile-import.test.ts tests/unit/components/settings-cost.test.ts` → FALHA.
- [ ] **Passo 3: Implementar:** `maxOutputTokens: 16000`, `tokensOut: 3000`, e a mensagem `truncated` do perfil passa a ser exatamente: `"A resposta da IA foi cortada. Tente de novo ou escolha outro modelo em Configurações."`. Ajustar o teste de `import-panel.test.tsx` se ele conferir esse texto.
- [ ] **Passo 4:** mesmo comando + `pnpm test` → PASSA.
- [ ] **Passo 5: Commit** `fix(perfil): dobra o teto de saída da leitura do currículo`

---

## Fase 2 — Seletor de modelos

### Task 3: Preço do Together, Vercel AI Gateway e IA local

**Arquivos:**
- Modificar: `lib/client/ai/providers.ts` (`compat()` ganha um `listModels` opcional; entradas `together`, `vercel-gateway`, `local`)
- Teste: criar `tests/unit/client/ai/providers-pricing.test.ts`

**Interfaces:**
- Produz: `ModelInfo.priceIn/priceOut` (USD por 1M tokens) preenchidos para `together`, `vercel-gateway` e `local` (0/0).

- [ ] **Passo 1: Testes que falham** (com `vi.stubGlobal("fetch", …)` devolvendo fixtures)

```ts
it("Together: pricing.input/output já em USD por 1M", async () => {
  // fixture: [{ id: "meta-llama/x", display_name: "Llama X", pricing: { input: 0.88, output: 0.88 } }]
  expect(await PROVIDERS.together.listModels({ apiKey: "k" }))
    .toEqual([{ id: "meta-llama/x", label: "Llama X", priceIn: 0.88, priceOut: 0.88 }]);
});
it("Vercel AI Gateway: pricing em USD por token vira USD por 1M", async () => {
  // fixture: { data: [{ id: "openai/gpt-5-mini", name: "GPT-5 mini", pricing: { input: "0.00000025", output: "0.000002" } }] }
  expect(r[0]).toMatchObject({ priceIn: 0.25, priceOut: 2 });
});
it("pricing ausente ou inválido vira sem preço, sem quebrar a lista", async () => {
  expect(r[0].priceIn).toBeUndefined();
});
it("IA local é grátis", async () => {
  expect(r[0]).toMatchObject({ priceIn: 0, priceOut: 0 });
});
```

- [ ] **Passo 2:** `pnpm vitest run tests/unit/client/ai/providers-pricing.test.ts` → FALHA.
- [ ] **Passo 3: Implementar** `listTogether(cfg)` e `listVercelGateway(cfg)` em `providers.ts`. Usar schemas `z.looseObject` com `safeParse` por item (como o `listOpenRouter`) e o `perMillion` existente para o Gateway. O Together devolve um **array na raiz**; aceitar também `{ data: [...] }`. A resposta real das duas APIs é premissa da spec: confirmar o formato na documentação (context7/site) antes de implementar e, se divergir, seguir a documentação e ajustar a fixture.
- [ ] **Passo 4:** mesmo comando + `pnpm test` → PASSA.
- [ ] **Passo 5: Commit** `feat(ia): lê o preço dos modelos do Together, do Vercel AI Gateway e da IA local`

### Task 4: Ordenação e rótulo de preço

**Arquivos:**
- Modificar: `components/settings/cost.ts`
- Teste: `tests/unit/components/settings-cost.test.ts`

**Interfaces:**
- Produz:
  - `operationCost(task: AiTask, model: Pick<ModelInfo,"priceIn"|"priceOut"> | undefined): number | undefined` (USD por operação; `undefined` sem preço). `estimateCost` passa a usá-la.
  - `sortModelsByCost(task: AiTask, models: ModelInfo[]): ModelInfo[]` (nova lista; não muta a entrada).
  - `priceLabel(task: AiTask, model: ModelInfo): string` → `"grátis"` | `"≈ US$ 0,0021 por currículo"` | `"sem preço"`.

- [ ] **Passo 1: Testes que falham**

```ts
it("ordena grátis, depois do mais barato ao mais caro, e sem preço no fim em ordem alfabética", () => {
  const ids = sortModelsByCost("extract", [
    { id: "c", label: "Caro", priceIn: 10, priceOut: 30 },
    { id: "z", label: "Zeta" },
    { id: "f", label: "Free", priceIn: 0, priceOut: 0 },
    { id: "b", label: "Barato", priceIn: 0.1, priceOut: 0.4 },
    { id: "a", label: "Alfa" },
  ]).map((m) => m.id);
  expect(ids).toEqual(["f", "b", "c", "a", "z"]);
});
it("empate de custo desempata por rótulo e depois por id", () => {
  // dois com o mesmo preço e rótulo "X": ids "x2" e "x1" -> ["x1", "x2"]
});
it("não muta a lista recebida", () => { /* compara a referência e a ordem originais */ });
it("priceLabel", () => {
  expect(priceLabel("extract", { id: "f", label: "F", priceIn: 0, priceOut: 0 })).toBe("grátis");
  expect(priceLabel("extract", { id: "z", label: "Z" })).toBe("sem preço");
  expect(priceLabel("analyze", { id: "b", label: "B", priceIn: 0.1, priceOut: 0.4 })).toBe("≈ US$ 0,0006 por vaga");
});
```

- [ ] **Passo 2:** `pnpm vitest run tests/unit/components/settings-cost.test.ts` → FALHA.
- [ ] **Passo 3: Implementar** as três funções. A comparação de rótulos usa `localeCompare(…, "pt-BR", { sensitivity: "base" })`.
- [ ] **Passo 4:** mesmo comando → PASSA.
- [ ] **Passo 5: Commit** `feat(config): ordena modelos por custo estimado`

### Task 5: Combobox pesquisável no campo Modelo

**Arquivos:**
- Criar: `components/ui/combobox.tsx` (wrapper fino de `@base-ui/react/combobox`, no estilo de `components/ui/select.tsx`: `Combobox` = Root, `ComboboxInput`, `ComboboxTrigger`, `ComboboxPopup` (Portal+Positioner+Popup), `ComboboxList`, `ComboboxItem` (com `ItemIndicator`), `ComboboxEmpty`)
- Modificar: `components/settings/TaskModelRow.tsx:126-142` (só o campo Modelo; o Provedor continua `<select>`)
- Teste: `tests/unit/client/task-model-row.test.tsx`

**Interfaces:**
- Consome: `sortModelsByCost`, `priceLabel` (Task 4); `ModelInfo` com preço (Task 3).

- [ ] **Passo 1: Testes que falham** (`QueryClient` com `setQueryData(["ai-models", "openrouter", addedAt], lista)` para não buscar na rede; settings com OpenRouter conectado e `tasks.extract` escolhido)

```ts
it("o campo Modelo é um combobox com o rótulo 'Modelo'", () => {
  expect(screen.getByRole("combobox", { name: "Modelo" })).toBeTruthy();
});
it("lista do mais barato ao mais caro, com o preço em cada item", async () => {
  // abrir o popup; os textos dos options, na ordem, contêm "grátis", "≈ US$ …", "sem preço"
});
it("filtra ignorando caixa e acento", async () => {
  // digitar "gemini" acha "Gêmini Flash"; digitar "CLAUDE" acha "Claude Haiku"
});
it("sem resultado mostra 'Nenhum modelo encontrado'", async () => {});
it("modelo salvo fora da lista do provedor continua visível e selecionado", () => {});
it("escolher um item chama onChange com provider e model", async () => {});
```

- [ ] **Passo 2:** `pnpm vitest run tests/unit/client/task-model-row.test.tsx` → FALHA.
- [ ] **Passo 3: Implementar.** `items = sortModelsByCost(task, list)`. Cada item mostra `label`, o selo "(recomendado)" quando aplicável e `priceLabel` à direita em `text-jf-ink-3`. O filtro normaliza com `normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()` sobre `label + " " + id`. O valor exibido no input é o `label` do modelo atual. Manter `htmlFor`/`id` do `<label>` ligados ao input. Desabilitado sem provedor ativo, com o placeholder "Modelo padrão do provedor". O custo ao lado (`estimateCost`) continua.
- [ ] **Passo 4:** mesmo comando + `pnpm test` + `pnpm test:e2e tests/e2e/settings.spec.ts` → PASSA (ajustar seletores do e2e que usem `selectOption` no Modelo).
- [ ] **Passo 5: Commit** `feat(config): campo Modelo pesquisável e ordenado por preço`

---

## Fase 3 — Tema claro/escuro

### Task 6: Provider de tema e script com hash na CSP

**Arquivos:**
- Criar: `lib/shared/theme-script.ts` (sem `client-only`: é lido pelo `csp.ts` no servidor)
- Criar: `lib/client/theme/ThemeProvider.tsx`
- Modificar: `lib/shared/csp.ts` (`buildNonceCsp` inclui o hash)
- Teste: criar `tests/unit/shared/theme-script.test.ts` e `tests/unit/client/theme.test.tsx`; ampliar `tests/unit/shared/csp.test.ts`

**Interfaces:**
- Produz:
  - `THEME_STORAGE_KEY = "jf-theme"`; `type ThemePref = "light" | "dark" | "system"`.
  - `THEME_SCRIPT: string`: IIFE que lê `localStorage[THEME_STORAGE_KEY]` com try/catch, resolve `system` por `matchMedia("(prefers-color-scheme: dark)")`, aplica a classe `dark` e `style.colorScheme` no `<html>`.
  - `THEME_SCRIPT_HASH: string`: literal `'sha256-…'` fixado no arquivo (sem crypto em runtime).
  - `ThemeProvider({ children })` e `useTheme(): { pref: ThemePref; resolved: "light" | "dark"; setPref(p: ThemePref): void }`.

- [ ] **Passo 1: Testes que falham**

```ts
// theme-script.test.ts
it("o hash fixado bate com o sha256 do script", () => {
  const h = createHash("sha256").update(THEME_SCRIPT, "utf8").digest("base64");
  expect(THEME_SCRIPT_HASH).toBe(`'sha256-${h}'`);
});
// csp.test.ts
it("a CSP com nonce libera o script de tema por hash", () => {
  expect(directive(buildNonceCsp([], "n"), "script-src")).toContain(THEME_SCRIPT_HASH);
});
it("a CSP pública não leva hash (senão 'unsafe-inline' seria ignorado)", () => {
  expect(directive(buildCsp([]), "script-src")).not.toContain("sha256-");
});
// theme.test.tsx
it("sem preferência salva segue o sistema", () => { /* matchMedia dark -> resolved "dark", <html> com .dark */ });
it("setPref('light') grava em localStorage e tira .dark", () => {});
it("localStorage que lança não quebra: usa o sistema", () => {});
it("muda junto com o sistema quando pref é 'system'", () => { /* dispara change no matchMedia */ });
```

- [ ] **Passo 2:** `pnpm vitest run tests/unit/shared tests/unit/client/theme.test.tsx` → FALHA.
- [ ] **Passo 3: Implementar.** Escrever `THEME_SCRIPT` e gerar o hash uma vez (`node -e` com `createHash`) para colar o literal. O provider guarda `pref` em estado, aplica a classe num `useEffect` e escuta `matchMedia` só quando `pref === "system"`. O `buildNonceCsp` acrescenta `THEME_SCRIPT_HASH` ao `scriptSrc`.
- [ ] **Passo 4:** mesmo comando + `pnpm test` → PASSA.
- [ ] **Passo 5: Commit** `feat(tema): provider de tema e script inicial liberado por hash`

### Task 7: Paleta escura

**Arquivos:**
- Modificar: `app/globals.css:51-71` (os `--color-jf-*` do `@theme` passam a apontar para variáveis `--jf-*` definidas em `:root` e redefinidas em `.dark`)
- Modificar (cor fixa → token): `components/jobs/JobsPage.tsx:267`, `components/jobs/AiAnalysis.tsx:62`, `components/settings/ProviderCard.tsx:111`, `components/generator/TailoredEditor.tsx:48`, `components/generator/GeneratorScreen.tsx:385`, `components/generator/ReviewBanner.tsx:5`, `components/profile/ImportPanel.tsx:119`, `components/layout/SiteHeader.tsx` (`text-white` do logo → `text-jf-surface`)
- Teste: criar `tests/unit/shared/palette.test.ts`

- [ ] **Passo 1: Teste que falha.** Lê `app/globals.css`, extrai os pares de `:root` e `.dark` e confere contraste WCAG ≥ 4,5:1 em `ink/bg`, `ink-2/surface`, `ink-3/surface`, `brand/surface`, `new-fg/new-bg`, `media-fg/media-bg`, `baixa-fg/baixa-bg`, `danger-fg/danger-bg`, nos dois temas. Mais um teste que falha se aparecer hex ou `bg-white` nos arquivos `.tsx` de `components/` e `app/` (exceto `lib/client/pdf`).
- [ ] **Passo 2:** `pnpm vitest run tests/unit/shared/palette.test.ts` → FALHA.
- [ ] **Passo 3: Implementar.** Valores escuros de partida: bg `#121418`, surface `#1b1e24`, line `#2c3038`, line-strong `#3b404a`, ink `#eceae5`, ink-2 `#c9c6bf`, ink-3 `#a3a7b0`, brand `#7d95ff`, brand-dark `#a9b8ff`, brand-soft `#1e2645`, chip `#252930`. Para os badges (new/media/baixa/danger), usar fundo escuro saturado com texto claro. Ajustar os valores até o teste de contraste passar. As cores amarelas fixas (`#E0B060`, `#7A4500`, `#5a3400`) viram tokens `jf-warn-*` novos.
- [ ] **Passo 4:** mesmo comando + `pnpm test` → PASSA.
- [ ] **Passo 5: Commit** `feat(tema): paleta escura com contraste AA`

### Task 8: Botão de tema, ligação no layout e e2e

**Arquivos:**
- Criar: `components/layout/ThemeToggle.tsx`
- Modificar: `app/layout.tsx` (`<html suppressHydrationWarning>`, `<head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>`), `app/providers.tsx` (envolver com `ThemeProvider`), `components/layout/SiteHeader.tsx` (toggle à direita do nav), `components/ui/sonner.tsx` (troca `next-themes` por `useTheme` próprio, `theme={resolved}`), `package.json`/`pnpm-lock.yaml` (`pnpm remove next-themes`)
- Teste: criar `tests/e2e/theme.spec.ts`; ampliar `tests/unit/client/theme.test.tsx`

**Interfaces:**
- Consome: `THEME_SCRIPT`, `ThemeProvider`, `useTheme` (Task 6); tokens (Task 7).

- [ ] **Passo 1: Testes que falham**

```ts
// theme.test.tsx
it("ThemeToggle alterna e expõe o estado", async () => {
  // botão com aria-label "Ativar tema escuro" e aria-pressed=false; clique -> "Ativar tema claro", aria-pressed=true
});
// theme.spec.ts (Playwright)
test("alternar o tema na home persiste ao ir para /perfil, sem flash e sem violação de CSP", async ({ page }) => {
  // registrar securitypolicyviolation como no csp-local.spec.ts
  // goto "/", clicar "Ativar tema escuro", esperar html.dark
  // goto "/perfil": html já tem .dark no primeiro paint (checar via addInitScript + MutationObserver ou logo após domcontentloaded)
  // violações === []
});
test("primeira visita segue o sistema", async ({ browser }) => {
  // newContext({ colorScheme: "dark" }) -> html.dark sem clicar
});
```

- [ ] **Passo 2:** `pnpm vitest run tests/unit/client/theme.test.tsx` → FALHA.
- [ ] **Passo 3: Implementar.** O toggle é um `<button>` com ícone `Moon`/`Sun` (lucide), `aria-label` "Ativar tema escuro"/"Ativar tema claro" e `aria-pressed={resolved === "dark"}`. O clique faz `setPref(resolved === "dark" ? "light" : "dark")`. Antes de montar, renderizar um placeholder do mesmo tamanho para evitar mismatch de hidratação. Usar o mesmo estilo de foco do `NavLink`.
- [ ] **Passo 4:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:e2e tests/e2e/theme.spec.ts tests/e2e/csp-local.spec.ts` → tudo verde, e `grep -r next-themes app components lib` vazio.
- [ ] **Passo 5: Commit** `feat(tema): botão de tema claro/escuro no cabeçalho`

---

## Cobertura da spec

| Spec | Task |
|------|------|
| RF-01 / D-01 | 1, 2 |
| RF-02 / D-02 | 5 |
| RF-03 / D-03 (ordem) | 4, 5 |
| RF-04 / D-03 (preço) | 3, 4, 5 |
| RF-05 / D-04 | 6, 7, 8 |

**Desvio da spec, registrado:** a D-01 dizia OpenAI `"minimal"` e Google `thinkingBudget: 0`. O plano usa `"low"` e `128`, porque `"minimal"` é rejeitado pelos modelos o-series e `0` pelo Gemini 2.5 Pro. Também ficou de fora o parâmetro de raciocínio do xAI: ele passa pelo `openai-compatible`, e o grok-4 rejeita `reasoning_effort`.
