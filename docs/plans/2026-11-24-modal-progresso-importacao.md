# Modal de progresso da importação do CV: plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** trocar o aviso de uma linha da importação do CV por um modal com etapas, porcentagem estimada (que nunca volta) e o que a IA já encontrou.

**Arquitetura:** uma função pura calcula a porcentagem a partir da etapa, do tempo na etapa e do tamanho do JSON parcial que o `generateStructured` já emite via `onPartial`. O `ImportPanel` guarda esse estado e renderiza um novo `ImportProgressDialog` (Base UI `Dialog`, que já existe).

**Stack:** Next.js + React 19, `@base-ui/react` (Dialog), Vitest + Testing Library, Playwright.

**Spec:** [docs/tech/2026-11-24-modal-progresso-importacao.md](../tech/2026-11-24-modal-progresso-importacao.md)

## Restrições globais

- Nenhuma dependência nova e nenhuma chamada de IA a mais (RNF-02).
- Sem mudança em `lib/client/ai/generate.ts` (D-04).
- Faixas: leitura 0→15, IA esperando 15→30 (τ = 8000 ms), IA respondendo 30→95, fim 100. Estimativa = `clamp(cvLength × 1,2; 1500; 40000)` (D-01).
- O valor exibido é `max(anterior, novo)`, inteiro (D-01).
- Textos em pt-BR. Os rótulos de etapa ao vivo continuam **"Lendo o arquivo..."** e **"Estruturando o currículo com IA..."** (os testes atuais dependem deles).
- Fechar: botão "Cancelar", X ou Esc cancelam; clique fora não fecha (`disablePointerDismissal`) (D-03).
- O parcial da IA é `unknown`: lido só com guardas, renderizado só como números/texto.
- Verificação final: `pnpm typecheck && pnpm lint && pnpm test`, e `pnpm test:e2e tests/e2e/profile.spec.ts`.
- Não commitar sem o usuário pedir (regra do projeto). Os passos "Commit" abaixo só valem se o usuário autorizar.

## Foco de revisão

- Importar com perfil existente: o `onImported` abre a confirmação de substituição do `ProfileScreen`; o modal de progresso precisa já estar fechado nessa hora (sem dois diálogos empilhados). Por isso o modal fecha **logo** no sucesso, sem o "Pronto!" de 400 ms previsto na spec. Teste na Tarefa 2.
- Clicar em "Tentar de novo" após um erro: o progresso volta a 0 (nova importação), não fica no valor da anterior. Teste na Tarefa 2.
- Parcial com formato estranho (`null`, array, `experiences` como string): o resumo vira zeros, sem quebrar. Teste na Tarefa 1.
- CV muito curto (texto colado de 200 caracteres): a estimativa usa o piso 1500, então a barra não pula para 95% no primeiro trecho. Teste na Tarefa 1.
- Cancelar durante a análise e importar de novo: o ticker antigo não continua mexendo na barra. Teste na Tarefa 2.

---

### Tarefa 1: cálculo do progresso e `onPartial` na importação

**Arquivos:**
- Criar: `lib/client/profile/import-progress.ts`
- Modificar: `lib/client/profile/import.ts:23-40`
- Teste: `tests/unit/client/import-progress.test.ts` (novo), `tests/unit/client/profile-import.test.ts`

**Interfaces:**
- Produz (em `import-progress.ts`, sem `"client-only"` para ser testável sem mock):
  ```ts
  export type ImportPhase = "reading" | "waiting" | "streaming" | "done";
  export type ProgressInput = { phase: ImportPhase; phaseStartedAt: number; cvLength: number; receivedChars: number };
  export function expectedOutputChars(cvLength: number): number;
  export function rawProgress(input: ProgressInput, now: number): number; // 0..100, fracionário
  export function nextProgress(prev: number, input: ProgressInput, now: number): number; // inteiro, >= prev
  export type FoundSummary = { experiences: number; skills: number; education: number; headline: string | null };
  export function summarizePartial(p: unknown): FoundSummary;
  export function formatFound(s: FoundSummary): string | null;
  ```
- Produz (em `import.ts`): `importProfile(text: string, settings: AiSettings, signal?: AbortSignal, onPartial?: (p: unknown) => void): Promise<Profile>`, repassando `onPartial` ao `generateStructured`.

- [ ] **Passo 1: escrever os testes que falham** em `tests/unit/client/import-progress.test.ts`:
  - `expectedOutputChars`: `(200) → 1500`, `(10000) → 12000`, `(100000) → 40000`.
  - `rawProgress` leitura: `t=0 → 0`; `t=60000 → < 15` e `> 14.9`.
  - `rawProgress` esperando: `t=0 → 15`; `t=8000 → ≈ 15 + 15·(1 − e⁻¹)` (`toBeCloseTo(24.48, 1)`); `t=600000 → < 30`.
  - `rawProgress` respondendo: `cvLength=10000, receivedChars=6000 → 62.5`; `receivedChars=50000 → 95`.
  - `rawProgress` CV curto: `cvLength=200, receivedChars=300 → 43` (usa o piso 1500, não 240).
  - `rawProgress` fim: `→ 100`.
  - `nextProgress` nunca volta: `nextProgress(40, {phase:"streaming", receivedChars:0, cvLength:10000, …}, now) → 40`; arredonda: `nextProgress(0, {phase:"streaming", receivedChars:6000, cvLength:10000, …}, now) → 63`.
  - `summarizePartial`: `({experiences:[{},{}], skills:[{}], education:[], headline:"Dev"}) → {2,1,0,"Dev"}`; `(null)`, `([])`, `({experiences:"x"})` → `{0,0,0,null}`; `headline` só se for string não vazia.
  - `formatFound`: `{3,14,1,_} → "Encontrado até agora: 3 experiências · 14 competências · 1 formação"`; singular `{1,1,0,_} → "Encontrado até agora: 1 experiência · 1 competência"` (itens zerados somem); `{0,0,0,_} → null`.
- [ ] **Passo 2: rodar e ver falhar**: `pnpm vitest run tests/unit/client/import-progress.test.ts` → FAIL (módulo não existe).
- [ ] **Passo 3: implementar `import-progress.ts`** com as fórmulas das restrições globais: leitura `15·(1 − e^(−t/1500))`; esperando `15 + 15·(1 − e^(−t/8000))`; respondendo `30 + 65·min(1, received/expected)`; `nextProgress = max(prev, Math.round(raw))`. `t = max(0, now − phaseStartedAt)`.
- [ ] **Passo 4: rodar e ver passar**: mesmo comando → PASS.
- [ ] **Passo 5: teste do repasse** em `tests/unit/client/profile-import.test.ts`: `importProfile(texto, settings, undefined, spy)` chama o `generateStructured` mockado com `onPartial: spy` (siga o mock que o arquivo já usa). Rodar → FAIL; adicionar o parâmetro em `import.ts`; rodar → PASS.
- [ ] **Passo 6: commit** (só com autorização): `feat(perfil): calcula o progresso da importação e repassa onPartial`.

### Tarefa 2: modal de progresso no painel de importação

**Arquivos:**
- Criar: `components/profile/ImportProgressDialog.tsx`
- Modificar: `components/profile/ImportPanel.tsx` (estado do progresso em `run`, `ImportPanel.tsx:50-91`; troca do bloco `busy` em `ImportPanel.tsx:179-191` pelo modal)
- Teste: `tests/unit/client/import-panel.test.tsx`, `tests/e2e/profile.spec.ts`

**Interfaces:**
- Consome da Tarefa 1: `ImportPhase`, `ProgressInput`, `nextProgress`, `summarizePartial`, `formatFound`, e `importProfile(..., onPartial)`.
- Produz:
  ```ts
  type ImportProgressDialogProps = {
    open: boolean;
    phase: ImportPhase;          // "done" não é exibido: o modal fecha antes
    percent: number;             // inteiro 0..100
    found: string | null;        // saída de formatFound
    onCancel: () => void;
  };
  export function ImportProgressDialog(props: ImportProgressDialogProps): JSX.Element;
  ```

**Comportamento do `ImportPanel`:**
- Estado novo: `progress: ProgressInput | null`, `percent: number`, `found: FoundSummary`.
- Em `run`: zera `percent` para 0 e `found`; leitura → `phase:"reading"`; texto colado começa em `phase:"waiting"` com `percent` 15; antes de `importProfile` → `phase:"waiting"`, `cvLength = cvText.length`; no 1º `onPartial` → `phase:"streaming"`; em cada `onPartial` (só se `!ctrl.signal.aborted`) atualiza `receivedChars = JSON.stringify(p).length` e `found = summarizePartial(p)`.
- Ticker: `setInterval` de 200 ms enquanto `status !== "idle"`, que faz `setPercent(prev => nextProgress(prev, progress, Date.now()))`; limpo no `useEffect` cleanup (sem vazar entre importações).
- Sucesso: fecha o modal (status `"idle"`) **antes** de chamar `onImported`.
- Erro, PDF escaneado e Cancelar: fecham o modal; o alerta e o campo de colar continuam no card como hoje.

**Conteúdo do `ImportProgressDialog`** (usar `Dialog`, `DialogContent showCloseButton`, `DialogHeader`, `DialogTitle`, `DialogDescription` de `components/ui/dialog.tsx`, como em `OnboardingGuide.tsx:123`):
- Título "Importando seu currículo"; descrição "A IA está lendo e organizando seu currículo. Isso leva alguns segundos."
- Lista ordenada das etapas "Ler o arquivo", "Consultar a IA", "Conferir o resultado", com `aria-current="step"` na atual (leitura → 1ª; waiting/streaming → 2ª).
- Número grande `{percent}%` e barra: `role="progressbar"`, `aria-valuemin=0`, `aria-valuemax=100`, `aria-valuenow={percent}`, `aria-valuetext={`cerca de ${percent}%, ${rótulo}`}`, `aria-label="Progresso da importação"`. Largura por `style={{ width: \`${percent}%\` }}`, cor `bg-jf-brand`, trilho `bg-jf-surface-2`, `transition-[width] motion-reduce:transition-none`.
- `<p aria-live="polite">` com o rótulo da etapa: `"Lendo o arquivo..."` (reading) ou `"Estruturando o currículo com IA..."` (waiting/streaming).
- Linha `found` (se não for `null`) em `text-jf-ink-2`.
- Botão "Cancelar" (`BTN_OUTLINE`) → `onCancel`. `Dialog` com `disablePointerDismissal` e `onOpenChange={(o) => !o && onCancel()}` (X e Esc).

- [ ] **Passo 1: testes que falham** em `tests/unit/client/import-panel.test.tsx` (mantenha os dois testes de Cancelar existentes; eles devem continuar passando sem mudança, porque o rótulo e o botão "Cancelar" agora estão no modal):
  - `"abre o modal com a etapa de leitura"`: ao escolher o arquivo, `findByRole("dialog", { name: "Importando seu currículo" })` existe e `getByText("Lendo o arquivo...")`.
  - `"mostra o que a IA encontrou e a porcentagem sobe"`: `importProfile` mockado chama `onPartial({ experiences:[{},{},{}], skills: Array(14).fill({}), education:[{}] })` e fica pendente; esperar `findByText("Encontrado até agora: 3 experiências · 14 competências · 1 formação")` e `Number(getByRole("progressbar").getAttribute("aria-valuenow")) >= 30`.
  - `"Esc cancela e fecha"`: `fireEvent.keyDown(dialog, { key: "Escape" })` → diálogo some, `fileInput().disabled === false`, e o resultado tardio não chama `onImported`.
  - `"sucesso fecha o modal antes do onImported"`: `onImported` mockado com `vi.fn(() => expect(screen.queryByRole("dialog")).toBeNull())`; resolve `importProfile` → `onImported` chamado 1 vez.
  - `"erro fecha o modal e mostra o alerta no card"`: `importProfile` rejeita com `new AiError("unavailable", { retryable: true })` → `queryByRole("dialog") === null` e `getByRole("alert")` com "Tentar de novo".
  - `"Tentar de novo recomeça do zero"`: depois do erro com o `onPartial` já tendo levado a barra acima de 30, clicar em "Tentar de novo" com um `extractText` pendente → `aria-valuenow` < 15.
  - `"PDF escaneado fecha o modal e abre o campo de colar"`: `extractText` → `{ scanned: true, … }` → sem diálogo, `getByLabelText("Texto do currículo")` focado.
- [ ] **Passo 2: rodar e ver falhar**: `pnpm vitest run tests/unit/client/import-panel.test.tsx` → FAIL (sem diálogo).
- [ ] **Passo 3: implementar `ImportProgressDialog.tsx`** conforme o conteúdo acima.
- [ ] **Passo 4: integrar no `ImportPanel.tsx`** conforme o comportamento acima, removendo o bloco `busy` inline.
- [ ] **Passo 5: rodar e ver passar**: mesmo comando → PASS (novos + os 2 de Cancelar).
- [ ] **Passo 6: e2e**: rodar `pnpm test:e2e tests/e2e/profile.spec.ts`. Onde um teste esperar o fim da importação, esperar também `expect(page.getByRole("dialog", { name: "Importando seu currículo" })).toBeHidden()` antes de interagir com a confirmação de substituição (`profile.spec.ts:204`). Esperado: todos PASS.
- [ ] **Passo 7: verificação completa**: `pnpm typecheck && pnpm lint && pnpm test` → sem erros.
- [ ] **Passo 8: conferência visual** no app (`run` skill): importar um PDF real, ver o modal no tema claro e no escuro, em 375 px de largura.
- [ ] **Passo 9: commit** (só com autorização): `feat(perfil): modal de progresso na importação do CV`.

---

**Dependências:** a Tarefa 2 consome a 1. Não há tarefas paralelizáveis (são só 2 e em sequência).
