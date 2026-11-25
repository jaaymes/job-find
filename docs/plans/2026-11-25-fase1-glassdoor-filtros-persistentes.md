# Fase 1: Glassdoor, filtros persistentes e perfil não salvo. Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** link de busca do Glassdoor por vaga, filtros que sobrevivem à navegação e à visita seguinte, e aviso ao sair do perfil com alterações não salvas.

**Arquitetura:** tudo no cliente. A URL (nuqs) continua sendo a fonte da verdade dos filtros. Uma store nova no localStorage (`jobfind:v1:lastFilters`) só reabastece a URL na abertura e alimenta os links que levam de volta à lista. O "Voltar" do detalhe usa `router.back()` quando a vaga foi aberta a partir da lista. O Glassdoor é uma função pura que monta a URL.

**Stack:** Next.js 16 App Router, React 19, nuqs 2, Zod 4, `createStore` próprio (`lib/client/storage/store.ts`), `@base-ui/react` 1.9, Vitest (jsdom) e Playwright.

**Spec:** [docs/tech/2026-11-25-fase1-glassdoor-filtros-persistentes.md](../tech/2026-11-25-fase1-glassdoor-filtros-persistentes.md) (PRD: [docs/prd/2026-11-25-glassdoor-filtros-ia-perfil-templates-cv.md](../prd/2026-11-25-glassdoor-filtros-ia-perfil-templates-cv.md))

## Restrições globais

- Sem variável de ambiente e sem feature flag: tudo entra já ativo.
- Todo texto visível em pt-BR, com acentuação correta.
- URL do Glassdoor: `https://www.glassdoor.com.br/Search/results.htm?keyword=<nome>` (origem `national` ou `unknown`) e `https://www.glassdoor.com/Search/results.htm?keyword=<nome>` (`international`).
- Validade da última busca: `LAST_FILTERS_TTL_MS = 7 * 24 * 60 * 60 * 1000`.
- Precedência na abertura: query da URL > última busca (≤ 7 dias) > busca padrão > nada.
- `ocultas` (`showHidden`) nunca é salvo nem restaurado.
- `jobfind:v1:lastFilters` fica fora de `BACKUP_KEYS`.
- Mensagem do aviso de saída: `Você tem alterações não salvas no perfil. Sair mesmo assim?`
- Texto do aviso de restauração: `Busca da última visita restaurada` + botão `Limpar`.
- Links externos: `target="_blank"` e `rel="noopener noreferrer nofollow"`, com o sufixo para leitor de tela `(abre em nova aba)`.
- Alvos de toque ≥ 44 px (`min-h-11`).
- Rotas `(local)` continuam com `HardLink`; não trocar por `next/link`.
- Verificação de cada tarefa: `pnpm typecheck && pnpm lint` + os testes da tarefa.
- Branch: `feat/fase1-filtros-glassdoor`. Só faça commit se a execução foi autorizada a commitar.

## Foco da revisão

1. **Restauração sobrescrita pela gravação:** na montagem sem query, o efeito que grava a última busca não pode rodar antes da restauração. Senão grava `null` e apaga a busca. Teste na Tarefa 3.
2. **Store corrompida ou de schema antigo** (ex.: `{ filters: { workMode: "x" } }`, `savedAt` inválido): deve virar "sem última busca", sem quebrar a home. Teste na Tarefa 3.
3. **"Voltar" numa vaga aberta em nova aba ou por link direto:** nunca chama `router.back()` (sairia do app). Teste na Tarefa 5.
4. **Nome de empresa com só sufixo ou vazio** ("Ltda.", "  ", "(Confidencial)"): sem link do Glassdoor e sem URL `keyword=`. Teste na Tarefa 1.
5. **Clique com ctrl/meta, botão do meio ou `target="_blank"` com o perfil sujo:** não pode abrir o `confirm` nem bloquear. Teste na Tarefa 7.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `lib/client/jobs/glassdoor.ts` (novo) | `normalizeCompanyForSearch`, `buildGlassdoorUrl` |
| `components/jobs/JobCardMenu.tsx`, `JobCard.tsx`, `JobDetail.tsx` | Pontos de UI do Glassdoor e do "Voltar" |
| `lib/client/jobs/saved-search.ts` | `lastFiltersStore`, `useRememberFilters`, `useRestoreFilters` (substitui `useApplySavedSearch`) |
| `lib/client/storage/keys.ts` | Nova `StorageKey` |
| `lib/client/jobs/use-jobs.ts` | Exporta `serializeFilters` |
| `lib/client/jobs/list-href.ts` (novo) | `useJobsListHref`, `markListReturn`, `consumeListReturn` |
| `components/jobs/JobsListLink.tsx` (novo) | Link client para a lista com a última busca |
| `components/jobs/BackToJobsLink.tsx` (novo) | "Voltar" com `router.back()` condicional |
| `components/layout/SiteHeader.tsx`, `MobileTabBar.tsx` | Usam o href da lista |
| `components/jobs/JobsPage.tsx` | Liga restauração, gravação e aviso |
| `lib/client/use-unsaved-changes-guard.ts` (novo) | `beforeunload` + confirm em links |
| `components/profile/ProfileEditor.tsx` | Estado `dirty` + guarda |
| `app/(site)/privacidade/page.tsx` | Cita a última busca |

---

### Task 1: Tarefa 1 — URL de busca do Glassdoor

**Arquivos:**
- Criar: `lib/client/jobs/glassdoor.ts`
- Teste: `tests/unit/client/jobs/glassdoor.test.ts`

**Interfaces:**
- Produz: `normalizeCompanyForSearch(name: string): string | null` e `buildGlassdoorUrl(company: string, origin: JobOrigin): string | null` (`JobOrigin` de `@/lib/shared/types/job`).

- [ ] **Passo 1: escrever os testes que falham**

```ts
describe("normalizeCompanyForSearch", () => {
  it.each([
    ["Acme Tecnologia Ltda.", "Acme Tecnologia"],
    ["Foo S.A.", "Foo"],
    ["Foo S/A", "Foo"],
    ["Bar Inc.", "Bar"],
    ["Baz, LLC", "Baz"],
    ["Qux GmbH", "Qux"],
    ["Nubank (Nu Pagamentos)", "Nubank"],
    ["Acme Ltda ME", "Acme"],
    ["  Stone  ", "Stone"],
  ])("%s → %s", (input, out) => expect(normalizeCompanyForSearch(input)).toBe(out));

  it.each(["", "  ", "Ltda.", "(Confidencial)", "Confidencial", "Empresa Confidencial", "CONFIDENTIAL", "Stealth Startup", "Undisclosed", "Empresa", "N/A", "Não informado", "X"])(
    "%j → null",
    (input) => expect(normalizeCompanyForSearch(input)).toBeNull(),
  );
});

describe("buildGlassdoorUrl", () => {
  const parse = (c: string, o: JobOrigin) => new URL(buildGlassdoorUrl(c, o)!);
  it("nacional e desconhecida usam .com.br; internacional usa .com", () => {
    expect(parse("Nubank", "national").origin).toBe("https://www.glassdoor.com.br");
    expect(parse("Nubank", "unknown").origin).toBe("https://www.glassdoor.com.br");
    expect(parse("Stripe", "international").origin).toBe("https://www.glassdoor.com");
  });
  it("usa /Search/results.htm com keyword codificada", () => {
    const u = parse("Itaú & Cia Ltda", "national");
    expect(u.pathname).toBe("/Search/results.htm");
    expect(u.searchParams.get("keyword")).toBe("Itaú & Cia");
  });
  it("nome genérico → null", () => expect(buildGlassdoorUrl("Confidencial", "national")).toBeNull());
});
```

- [ ] **Passo 2:** rodar `pnpm vitest run tests/unit/client/jobs/glassdoor.test.ts`. Esperado: FAIL (módulo inexistente).
- [ ] **Passo 3: implementar em `lib/client/jobs/glassdoor.ts`.** Remove `(...)`; tira sufixos societários do fim em laço até estabilizar (regex sem diferenciar maiúsculas para `Ltda\.?|S\.?\/?A\.?|ME|EPP|EIRELI|Inc\.?|LLC|Ltd\.?|GmbH|Corp\.?|Co\.?`, precedidos de espaço ou vírgula); apara vírgulas e espaços. Compara com a lista de genéricos da spec (D-01) sem acento (`normalize("NFD")` + remover marcas) e em minúsculas. Devolve `null` se o resultado tiver menos de 2 caracteres. Monta a URL com `new URL()` + `searchParams.set("keyword", ...)`.
- [ ] **Passo 4:** rodar o mesmo comando. Esperado: PASS.
- [ ] **Passo 5: commit** `feat(vagas): URL de busca da empresa no Glassdoor`

### Task 2: Tarefa 2 — link do Glassdoor no detalhe e no menu ⋯

**Arquivos:**
- Modificar: `components/jobs/JobCardMenu.tsx`, `components/jobs/JobCard.tsx`, `components/jobs/JobDetail.tsx` (linha da empresa no `JobDetailView` e `MobileTopBar`)
- Teste: `tests/unit/client/job-card.test.tsx`, `tests/unit/client/job-detail.test.tsx`

**Interfaces:**
- Consome: `buildGlassdoorUrl` (Tarefa 1).
- Produz: prop `glassdoorUrl?: string | null` em `JobCardMenu`.

- [ ] **Passo 1: testes que falham**
  - `job-card.test.tsx`: com `company: "Nubank", origin: "national"`, ao abrir o menu ⋯ existe `getByRole("menuitem", { name: "Ver empresa no Glassdoor" })` com `href` `https://www.glassdoor.com.br/Search/results.htm?keyword=Nubank` e `target="_blank"`. Com `company: "Confidencial"`, `queryByRole(...)` é `null`.
  - `job-detail.test.tsx`: `getByRole("link", { name: /Ver Nubank no Glassdoor/ })` com o mesmo `href`, `rel` contendo `nofollow` e o texto "(abre em nova aba)" no nome acessível.
- [ ] **Passo 2:** `pnpm vitest run tests/unit/client/job-card.test.tsx tests/unit/client/job-detail.test.tsx`. Esperado: FAIL.
- [ ] **Passo 3: implementar.**
  - `JobCardMenu`: um `Menu.LinkItem` (`render`/`href`, `target="_blank"`, `rel`) entre "Copiar link" e "Ocultar", só quando `glassdoorUrl`.
  - `JobCard` e `MobileTopBar`: passam `buildGlassdoorUrl(job.company, job.origin)`.
  - `JobDetailView`: depois de `{job.company}`, um `<a>` com ícone `ExternalLink` (lucide, `aria-hidden`), texto visível "Glassdoor", nome acessível `Ver ${job.company} no Glassdoor (abre em nova aba)` (via `aria-label`), classe `LINK` + `inline-flex min-h-11 items-center gap-1`.
- [ ] **Passo 4:** rodar os testes. Esperado: PASS. Depois `pnpm typecheck && pnpm lint`.
- [ ] **Passo 5: commit** `feat(vagas): link do Glassdoor no detalhe e no menu da vaga`

### Task 3: Tarefa 3 — store da última busca, gravação e restauração com precedência

**Arquivos:**
- Modificar: `lib/client/jobs/saved-search.ts`, `lib/client/storage/keys.ts`, `components/jobs/JobsPage.tsx:93-95`
- Renomear o teste: `tests/unit/client/apply-saved-search.test.ts` → `tests/unit/client/restore-filters.test.ts`
- Teste: `tests/unit/client/saved-search.test.ts` (gravação)

**Interfaces:**
- Produz:
  - `lastFiltersStore: Store<{ filters: SavedFilters; savedAt: string } | null>` (chave `jobfind:v1:lastFilters`, versão 1);
  - `LAST_FILTERS_TTL_MS`;
  - `readLastFilters(now?: number): SavedFilters | null` (aplica TTL e `toSavedFilters`);
  - `useRememberFilters(filters: PageFilters, ready: boolean): void`;
  - `useRestoreFilters(filters, setFilters): { ready: boolean; restored: "last" | "saved" | null }`.
- Remove `useApplySavedSearch`, que tem um único consumidor: `JobsPage`.

- [ ] **Passo 1: testes que falham** (`restore-filters.test.ts`, mesmo mock de `next/navigation` do arquivo atual; `last(data, savedAt)` grava `{v:1,data:{filters:data,savedAt}}` em `jobfind:v1:lastFilters`). Adaptar os 4 casos existentes (o retorno passa a ser `result.current.ready`) e adicionar:
  - "URL com filtros vence a última busca": `last({lang:"pt"}, agora)`, `search="workMode=remote"` → `setFilters` não chamado, `restored === null`.
  - "última busca recente vence a busca padrão": saved `{lang:"en"}` e last `{lang:"pt"}` → `setFilters({lang:"pt"})`, `restored === "last"`.
  - "última busca com mais de 7 dias é ignorada e cai na busca padrão": `savedAt = agora − 7 dias − 1 ms` → `setFilters({lang:"en"})`, `restored === "saved"`.
  - "última busca corrompida é ignorada": `{filters:{workMode:"x"}, savedAt:"ontem"}` → cai na busca padrão.

  Em `saved-search.test.ts`, para `useRememberFilters`:
  - "não grava antes de ready": `ready=false`, `filters={}` → `localStorage.getItem("jobfind:v1:lastFilters")` continua com o valor semeado.
  - "grava sem showHidden": `{lang:"pt", showHidden:true}`, `ready=true` → `lastFiltersStore.get()?.filters` igual a `{lang:"pt"}`.
  - "filtros vazios gravam null".
  - "não regrava savedAt se os filtros não mudaram": rerender com objeto igual → `savedAt` inalterado.
- [ ] **Passo 2:** `pnpm vitest run tests/unit/client/restore-filters.test.ts tests/unit/client/saved-search.test.ts`. Esperado: FAIL.
- [ ] **Passo 3: implementar.**
  - `StorageKey` ganha `"jobfind:v1:lastFilters"`.
  - Em `saved-search.ts`: a escolha inicial no `useState` segue a ordem `hasFilterParams` → `readLastFilters()` → `readSavedSearch()`. `useRememberFilters` compara `JSON.stringify(toSavedFilters(filters))` com o valor salvo antes de gravar.
  - Em `JobsPage`: `const { ready: searchReady, restored } = useRestoreFilters(filters, setFilters); useRememberFilters(filters, searchReady);`.
- [ ] **Passo 4:** rodar os testes. Esperado: PASS. Depois `pnpm test` (suíte unit inteira) para garantir que nenhum outro teste importava `useApplySavedSearch`.
- [ ] **Passo 5: commit** `feat(filtros): lembra a última busca e restaura com precedência`

### Task 4: Tarefa 4 — aviso "Busca da última visita restaurada"

**Arquivos:**
- Modificar: `components/jobs/JobsPage.tsx`
- Teste: `tests/unit/client/jobs/restored-notice.test.tsx` (novo; componente `RestoredNotice` exportado de `JobsPage.tsx` ou arquivo próprio `components/jobs/RestoredNotice.tsx`)

**Interfaces:**
- Consome: `restored` (Tarefa 3) e `clear()` do `JobsPage`.
- Produz: `RestoredNotice({ onClear }: { onClear: () => void })`.

- [ ] **Passo 1: teste que falha.** Renderiza `RestoredNotice` e verifica `getByRole("status")` com o texto "Busca da última visita restaurada"; clicar em `getByRole("button", { name: "Limpar" })` chama `onClear`.
- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3: implementar.** No `JobsPage`: `const [noticeKey] = useState<string | null>(...)` guarda a serialização dos filtros quando `restored === "last"` e `ready`. A primeira serialização é capturada no render em que `ready` vira verdadeiro (padrão "ajustar estado no render", já usado no arquivo). O aviso aparece enquanto `serializeFilters("", filters) === noticeKey`. Fica acima dos chips, `text-[13px] text-jf-ink-2`, e o botão segue o estilo do "Limpar tudo" de `ActiveFilterChips`.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5: commit** `feat(filtros): aviso de busca restaurada com opção de limpar`

> A Tarefa 4 usa `serializeFilters` da Tarefa 5, Passo 3a. Faça a Tarefa 5 antes ou extraia `serializeFilters` primeiro.

### Task 5: Tarefa 5 — links para a lista com a última busca e "Voltar" pelo histórico

**Arquivos:**
- Modificar: `lib/client/jobs/use-jobs.ts`, `components/layout/SiteHeader.tsx`, `components/layout/MobileTabBar.tsx`, `components/jobs/JobCard.tsx`, `components/jobs/JobDetail.tsx` (`BackLink`, `MobileTopBar`, `NotFound`)
- Criar: `lib/client/jobs/list-href.ts`, `components/jobs/JobsListLink.tsx`, `components/jobs/BackToJobsLink.tsx`
- Teste: `tests/unit/client/jobs/list-href.test.ts`, `tests/unit/client/jobs/back-to-jobs-link.test.tsx`; ajustar `tests/unit/client/nav.test.tsx` e `mobile-tab-bar.test.tsx` se eles fixam `href="/"`

**Interfaces:**
- Consome: `lastFiltersStore`, `readLastFilters` (Tarefa 3).
- Produz:
  - `serializeFilters(base: string, filters: PageFilters): string` (em `use-jobs.ts`, via `createSerializer(urlParsers, { urlKeys: URL_KEY_OVERRIDES })`);
  - `useJobsListHref(): string`;
  - `markListReturn(jobId: number): void`;
  - `consumeListReturn(jobId: number): boolean` (lê e remove `sessionStorage["jobfind:session:listReturn"]`, devolve `true` se o `jobId` bate; try/catch devolve `false`);
  - `JobsListLink(props: Omit<ComponentProps<typeof Link>, "href">)`;
  - `BackToJobsLink({ jobId, className, children, "aria-label"? })`.

- [ ] **Passo 1: testes que falham**
  - `list-href.test.ts`:
    - "sem store, `/`";
    - "com store `{stacks:["react","node"], showHidden: undefined, workMode:"remote"}` gera `/?stacks=react,node&workMode=remote`", comparando com `serializeFilters("/", mesmos)` em vez de string fixa de ordem, e verificando `new URL(href, "http://x").searchParams.get("stacks") === "react,node"`;
    - "store expirada → `/`";
    - "`markListReturn(5)` e depois `consumeListReturn(5)` → `true`; segunda chamada → `false`; `consumeListReturn(6)` → `false`".
  - `back-to-jobs-link.test.tsx` (mock `next/navigation` com `useRouter: () => ({ back })`):
    - com `markListReturn(5)` e `history.pushState` feito uma vez (`history.length > 1`), clicar chama `back` e o `href` do link é o da última busca;
    - sem `markListReturn`, clicar não chama `back`;
    - com `listReturn` de outra vaga (7), não chama `back`;
    - clique com `ctrlKey: true` não chama `back`.
- [ ] **Passo 2:** `pnpm vitest run tests/unit/client/jobs/`. Esperado: FAIL.
- [ ] **Passo 3a:** `serializeFilters` em `use-jobs.ts`.
- [ ] **Passo 3b:** `list-href.ts`. `useJobsListHref` usa `useStore(lastFiltersStore)`: com `null` (servidor ou hidratação) devolve `"/"`; senão aplica `readLastFilters` e serializa.
- [ ] **Passo 3c:** `JobsListLink` (`"use client"`, `next/link`). `BackToJobsLink` renderiza `JobsListLink`. O `onClick` ignora modificadores e botão ≠ 0; se `consumeListReturn(jobId) && window.history.length > 1`, chama `preventDefault()` + `router.back()`.
- [ ] **Passo 3d:** trocas.
  - `SiteHeader`: o logo vira `JobsListLink` com as mesmas classes. O item `vagas` de `PRIMARY_NAV` é renderizado com `JobsListLink` + classes do `NavLink`: exportar a constante de classes ou criar a prop `as` no `NavLink`, sem mudar o visual.
  - `MobileTabBar`: `href` da aba `vagas` = `useJobsListHref()`.
  - `JobDetail`: `BackLink` e a seta do `MobileTopBar` viram `BackToJobsLink jobId={job.id}`; `NotFound` usa `JobsListLink`.
  - `JobCard`: no `onClick` do `Link` do título, `markListReturn(job.id)` quando não há modificador.
  - O clique em "Gerar CV" (`JobDetail.tsx:216` e `JobDetailActionBar.tsx:39`) chama `consumeListReturn(job.id)` para limpar a entrada (spec D-05).
- [ ] **Passo 4:** `pnpm vitest run tests/unit/client` + `pnpm typecheck && pnpm lint`. Esperado: PASS.
- [ ] **Passo 5: commit** `feat(filtros): links e "Voltar" preservam a busca`

### Task 6: Tarefa 6 — E2E de persistência e privacidade

**Arquivos:**
- Criar: `tests/e2e/filters-persistence.spec.ts` (copiar de `tests/e2e/home.spec.ts` o `beforeAll`/`beforeEach` com `seedDatabase` e o `page.route("**/api/jobs*")`)
- Modificar: `app/(site)/privacidade/page.tsx` (no parágrafo da linha ~34, citar "a última busca que você fez na lista de vagas")
- Teste: `tests/e2e/job-detail.spec.ts` (link do Glassdoor)

- [ ] **Passo 1: escrever os cenários** (filtros de partida: `/?workMode=remote&seniority=senior&stacks=react`):
  1. Desktop: abrir a 1ª vaga pelo título, clicar em "Voltar para as vagas" → URL contém os 3 parâmetros, e o primeiro card visível é o mesmo de antes.
  2. Desktop com "Carregar mais": clicar uma vez, abrir uma vaga da 2ª página, voltar → o número de cards é igual ao de antes.
  3. Desktop: ir a `/perfil` pelo header e clicar em "Vagas" → URL com os filtros.
  4. Logo a partir de `/fontes` → URL com os filtros.
  5. Celular (`viewport 390x844`): abrir uma vaga, tocar na seta de voltar → filtros mantidos. Depois ir a "Minhas vagas" e tocar na aba "Vagas" → filtros mantidos.
  6. Novo contexto com `addInitScript` gravando `jobfind:v1:lastFilters` (`savedAt` = agora) e abrindo `/` → URL recebe os filtros, aparece o status "Busca da última visita restaurada", "Limpar" remove os filtros, e recarregar `/` não restaura de novo.
  7. URL compartilhada `/?lang=en` com `lastFilters` de `lang: pt` → fica `lang=en`.
  8. `job-detail.spec.ts`: o link "Ver … no Glassdoor" tem `href` começando com `https://www.glassdoor.com`.
- [ ] **Passo 2:** `pnpm db:test:up && pnpm test:e2e tests/e2e/filters-persistence.spec.ts tests/e2e/job-detail.spec.ts`. Esperado: PASS (as Tarefas 1–5 já implementadas). Uma falha aqui é bug das tarefas anteriores: corrigir lá.
- [ ] **Passo 3: commit** `test(e2e): persistência de filtros e link do Glassdoor`

### Task 7: Tarefa 7 — aviso de alterações não salvas no perfil

**Arquivos:**
- Criar: `lib/client/use-unsaved-changes-guard.ts`
- Modificar: `components/profile/ProfileEditor.tsx:26-33`
- Teste: `tests/unit/client/unsaved-changes-guard.test.tsx`, `tests/e2e/profile.spec.ts`

**Interfaces:**
- Produz: `useUnsavedChangesGuard(dirty: boolean, message: string): void`.

- [ ] **Passo 1: testes que falham** (`unsaved-changes-guard.test.tsx`; render de um componente com o hook e links `<a href="/minhas-vagas">`, `<a href="/x" target="_blank">`, `<a href={location.pathname}>`; `vi.spyOn(window, "confirm")`):
  - `dirty=true`: clicar no link interno chama `confirm` com a mensagem exata; com retorno `false`, o evento sai com `defaultPrevented === true`.
  - Com retorno `true`, `defaultPrevented === false`.
  - `target="_blank"`, `ctrlKey`, `metaKey`, botão do meio (`button: 1`) e o mesmo caminho não chamam `confirm`.
  - `dirty=false` não chama `confirm`, e o `beforeunload` despachado sai com `defaultPrevented === false`.
  - `dirty=true`: o `beforeunload` sai com `defaultPrevented === true`.
  - Desmontar remove os listeners (clique depois de `unmount` não chama `confirm`).
- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3: implementar.** Listener `click` em `document` com `{ capture: true }`. Usar `event.target.closest("a[href]")`; checar mesma origem (`new URL(a.href).origin === location.origin`) e caminho diferente. No `ProfileEditor`: `const [dirty, setDirty] = useState(false)`; `patch` faz `setDirty(true)`; o clique em "Salvar perfil" com `onSave(draft) === true` faz `setDirty(false)`; chamar `useUnsavedChangesGuard(dirty, "Você tem alterações não salvas no perfil. Sair mesmo assim?")`.
- [ ] **Passo 4: E2E em `profile.spec.ts`.** Com perfil semeado, editar "Nome", clicar no link "Minhas vagas" com `page.once("dialog", d => d.dismiss())` → continua em `/perfil`. Clicar de novo com `d.accept()` → vai para `/minhas-vagas`. Salvar e depois clicar → nenhum diálogo (falha se `dialog` disparar).
- [ ] **Passo 5:** `pnpm vitest run tests/unit/client/unsaved-changes-guard.test.tsx && pnpm test:e2e tests/e2e/profile.spec.ts`. Esperado: PASS.
- [ ] **Passo 6: commit** `feat(perfil): avisa antes de sair com alterações não salvas`

### Verificação final

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`. Esperado: tudo verde.
- [ ] `pnpm build`. Esperado: sucesso (o `SiteHeader` agora importa um client component).

## Ordem e paralelismo

- Independentes entre si: **Tarefa 1** (Glassdoor), **Tarefa 3** (store) e **Tarefa 7** (perfil). Podem rodar em paralelo, sem arquivos em comum.
- **Tarefa 2** depende da 1. **Tarefa 5** depende da 3. **Tarefa 4** depende da 3 e do `serializeFilters` da 5. **Tarefa 6** depende de todas, exceto a 7.
- As Tarefas 2 e 5 tocam `JobCard.tsx` e `JobDetail.tsx`: executar em sequência (2 antes de 5).
- Caminho crítico: 3 → 5 → 4 → 6.
