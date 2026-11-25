# Redesign UX/UI desktop + UI mobile — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** corrigir as falhas de UX e de acessibilidade apontadas na auditoria e dar ao Job Find uma interface própria para celular, com barra de abas, sheets e barras de ação fixas, sem trocar a identidade visual.

**Arquitetura:**
- A base é unificar os tokens (shadcn passa a apontar para `jf-*`) e criar um primitivo `Sheet` sobre `@base-ui/react/dialog`.
- O mobile é feito com classes responsivas nos componentes existentes (`max-md:`, `lg:`) e poucos componentes novos: `MobileTabBar`, `MoreSheet`, `SetupProgress`, `JobCardMenu` e `JobDetailActionBar`.
- Nenhuma rota, store ou API muda.

**Stack:** Next.js 16 App Router, React 19, Tailwind v4, `@base-ui/react`, Vitest (jsdom), Playwright.

**Spec:** [docs/tech/2026-11-24-redesign-ux-mobile.md](../tech/2026-11-24-redesign-ux-mobile.md). **Design:** [canvas](https://claude.ai/artifact/GBEFUsdUZXkckBagLg7jtK) · [Design System](https://claude.ai/artifact/GPYm42oZ7ZsbaSUmJBck4i).

## Restrições globais

- WCAG 2.2 AA nos dois temas: texto com 4,5:1; bordas de controle, foco e ícones com 3:1.
- Celular (abaixo de 768px): alvos de toque com no mínimo 44px (`min-h-11`/`size-11`) e campos de texto com fonte de 16px ou mais.
- Breakpoints:
  - `md` (768px): troca a barra de abas pelo header completo.
  - `lg` (1024px): troca o sheet de filtros pela sidebar e o gerador em abas pelo gerador em 2 colunas.
- Rotas `(local)` (`/perfil`, `/configuracoes`, `/minhas-vagas`, `/gerador/*`) só com `HardLink`, nunca com `next/link` (`components/ui/hard-link.tsx`).
- Nenhuma dependência nova. A pré-visualização usa o `unpdf/pdfjs` que já existe; a CSP já tem `worker-src 'self' blob:` (`lib/shared/csp.ts:19`).
- Nada de feature flag ou variável de ambiente: tudo entra ativo (regra do usuário).
- Textos da interface em pt-BR, botões no imperativo, sem emoji.
- Tokens novos: `--jf-on-brand` (`#ffffff` / `#121418`), `--jf-field-border` (`#8f8b82` / `#5a606b`) e `--jf-fav` (`#b45309` / `#f59e0b`).
- Verificação de cada tarefa: `pnpm typecheck && pnpm lint && pnpm test`, mais a spec E2E indicada. Quando a tarefa mexe em layout ou rotas, também `pnpm build`.

## Foco de revisão

1. **`?voltar` malicioso** (`//evil.com`, `https://…`, `/vagas/../perfil`, `javascript:`): é ignorado e o link de volta não aparece. Teste na Tarefa 8.
2. **Teclado aberto no celular** (iOS e Android): a barra de abas e as barras de ação não cobrem o campo em foco. Ficam ocultas enquanto um campo de texto tem foco (`:has(input:focus, textarea:focus)`). Teste na Tarefa 6.
3. **Sheet aberto e rotação ou redimensionamento para 1024px ou mais:** os filtros não podem ficar presos num sheet invisível. O sheet fecha quando a mídia `lg` passa a valer. Teste na Tarefa 11.
4. **Nova aba pela barra (`HardLink`):** abrir /perfil a partir da barra não gera violação de CSP. Teste E2E na Tarefa 7.
5. **"Limpar filtros" no sheet com busca preenchida:** a busca é preservada. Teste na Tarefa 11.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `app/globals.css` | Tokens novos e mapeamento shadcn → `jf-*` |
| `app/layout.tsx` | `export const viewport` e link "Pular para o conteúdo" |
| `components/ui/sheet.tsx` (novo) | Primitivo Sheet (bottom ou full) |
| `components/ui/skeleton.tsx` (novo) | Skeleton com `motion-reduce:animate-none` |
| `components/layout/nav.ts` (novo) | `NAV_ITEMS`, `isLocalRoute()` e `navItemForPath()` |
| `components/layout/NavLink.tsx` (novo) | Link que escolhe entre `Link` e `HardLink` |
| `components/layout/MobileTabBar.tsx` + `MoreSheet.tsx` (novos) | Navegação mobile |
| `components/layout/AppShell.tsx` (novo) | Header + main + footer + barra de abas |
| `lib/client/setup/progress.ts` (novo) | `getSetupProgress()` e `safeReturnPath()` |
| `components/onboarding/SetupProgress.tsx` (novo) | Banner, card e versão inline do progresso de setup |
| `components/jobs/JobCardMenu.tsx` (novo) | Menu "⋯": status, ocultar, copiar link |
| `components/jobs/ResultsToolbar.tsx` + `ActiveFilterChips.tsx` (novos) | Barra acima da lista |
| `components/jobs/JobDetailActionBar.tsx` (novo) | Barra de ação fixa no celular |

---

## Fase 1 — Fundação

### Task 1: Tokens unificados e contraste AA

**Arquivos:**
- Modificar: `app/globals.css` (`:root`, `.dark`, `@theme inline`)
- Modificar: `components/ui/styles.ts`
- Modificar: `components/jobs/JobActions.tsx:80`
- Teste: `tests/unit/shared/palette.test.ts`

**Interfaces:**
- Produz:
  - as utilities `bg-jf-on-brand`, `text-jf-on-brand`, `border-jf-field-border` e `text-jf-fav`;
  - shadcn `--primary`, `--ring` e as demais variáveis lendo `jf-*`.

- [ ] **Passo 1: testes que falham.** Em `PAIRS`, trocar `["surface","brand"]` e `["surface","brand-dark"]` por `["on-brand","brand"]` e `["on-brand","brand-dark"]`, e adicionar `["fav","surface"]`. Criar um bloco novo:

```ts
const NON_TEXT: [string, string][] = [["field-border", "surface"], ["field-border", "bg"], ["brand", "surface"]];
describe.each([":root", ".dark"])("controles %s", (selector) => {
  const vars = jfVars(selector);
  it.each(NON_TEXT)("%s sobre %s tem contraste >= 3:1", (fg, bg) => {
    expect(contrast(vars[fg], vars[bg])).toBeGreaterThanOrEqual(3);
  });
});
it("tokens shadcn apontam para a paleta jf", () => {
  for (const [shadcn, jf] of [["primary","brand"],["primary-foreground","on-brand"],["ring","brand"],["input","field-border"],["border","line"],["popover","surface"],["card","surface"],["background","surface"],["muted","chip"],["muted-foreground","ink-3"],["destructive","danger-fg"]])
    expect(css).toMatch(new RegExp(`--${shadcn}:\\s*var\\(--jf-${jf}\\)`));
});
```

- [ ] **Passo 2:** `pnpm vitest run tests/unit/shared/palette.test.ts` deve FALHAR: `--jf-on-brand` não existe.
- [ ] **Passo 3: implementar.**
  - Adicionar os três tokens nos dois temas, com os valores das Restrições globais, e mapeá-los em `--color-jf-*`.
  - Em `:root`, trocar as variáveis shadcn listadas por `var(--jf-…)`.
  - Apagar as redefinições dessas variáveis no `.dark`: elas herdam pelos `--jf-*`.
  - `BTN_PRIMARY`: `text-white` → `text-jf-on-brand`, e o hover passa a `hover:bg-jf-brand-dark` só no claro (`dark:hover:bg-jf-brand/85`).
  - `FIELD` e `BTN_OUTLINE`: `border-jf-line-strong` → `border-jf-field-border`.
  - `JobActions.tsx:80`: `text-amber-500` → `text-jf-fav`.
- [ ] **Passo 4:** `pnpm test` passa. Em seguida, `pnpm test:e2e tests/e2e/theme.spec.ts`.
- [ ] **Passo 5:** commit `feat(ui): unifica tokens shadcn na paleta jf e corrige contraste AA`.

### Task 2: Viewport, safe-area e "Pular para o conteúdo"

**Arquivos:**
- Modificar: `app/layout.tsx`, `app/(local)/layout.tsx`, `app/(site)/page.tsx`, `app/(site)/vagas/[id]/page.tsx` (`<main id="conteudo">`)
- Teste: `tests/unit/app/viewport.test.ts`

**Interfaces:**
- Produz: o alvo `#conteudo` em todo `<main>`.

- [ ] **Passo 1:** teste `viewport tem viewportFit cover e themeColor nos dois temas`: `expect(viewport).toMatchObject({ viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f6f5f2" }, { media: "(prefers-color-scheme: dark)", color: "#121418" }] })`.
- [ ] **Passo 2:** rodar o teste. Deve FALHAR.
- [ ] **Passo 3: implementar.**
  - `export const viewport: Viewport` em `app/layout.tsx`.
  - Primeiro filho do `<body>`: `<a href="#conteudo" className="sr-only focus:not-sr-only …">Pular para o conteúdo</a>`.
  - `id="conteudo"` nos três `<main>`.
- [ ] **Passo 4:** `pnpm test && pnpm build` passam.
- [ ] **Passo 5:** commit `feat(ui): viewport-fit cover, theme-color e link para pular ao conteúdo`.

### Task 3: Primitivo `Sheet`

**Arquivos:**
- Criar: `components/ui/sheet.tsx`
- Teste: `tests/unit/client/sheet.test.tsx`

**Interfaces:**
- Produz:

```ts
export function Sheet(props: { open?: boolean; onOpenChange?: (open: boolean) => void; children: React.ReactNode }): JSX.Element;
export function SheetTrigger(props: React.ComponentProps<"button">): JSX.Element;
export function SheetContent(props: { title: string; description?: string; side?: "bottom" | "full"; footer?: React.ReactNode; children: React.ReactNode; className?: string }): JSX.Element;
export function SheetClose(props: React.ComponentProps<"button">): JSX.Element;
```

- [ ] **Passo 1: testes que falham.**
  - `abre pelo trigger com role dialog e nome acessível do title`.
  - `Esc fecha e devolve o foco ao trigger`.
  - `footer fica fora da área rolável` (o `footer` não é descendente do elemento `[data-sheet-body]`).
  - `fechar tem 44px`: o botão de fechar tem a classe `size-11`.
- [ ] **Passo 2:** `pnpm vitest run tests/unit/client/sheet.test.tsx` deve FALHAR.
- [ ] **Passo 3: implementar** sobre `@base-ui/react/dialog`, no mesmo molde de `components/ui/dialog.tsx`.
  - **`bottom`:** `fixed inset-x-0 bottom-0 max-h-[90dvh] rounded-t-[20px] pb-[env(safe-area-inset-bottom)]`, com uma alça de 36×4px.
  - **`full`:** `fixed inset-0 h-dvh`.
  - **Visual:** sombra `shadow-[0_-8px_24px_rgba(21,23,28,.12)]` e véu `bg-black/45`.
  - **Animação:** sobe de baixo, com `motion-reduce:transition-none`.
- [ ] **Passo 4:** o teste passa.
- [ ] **Passo 5:** commit `feat(ui): primitivo Sheet sobre base-ui Dialog`.

### Task 4: Varredura de acessibilidade

**Arquivos:**
- Criar: `components/ui/skeleton.tsx`
- Modificar:
  - os 9 usos de `animate-pulse`: `JobsPage`, `JobDetail`, `GeneratorScreen`, `Board`, `ProfileScreen`, `AiSettingsScreen`;
  - `components/ui/dialog.tsx:69` (`size-11`);
  - `SiteFooter.tsx`, `StackChips.tsx:69,73` e `FiltersPanel.tsx:58` (`min-h-11 inline-flex items-center`);
  - `ProfileScreen.tsx:64` (`font-display`);
  - `app/globals.css`: `h1,h2,h3{text-wrap:balance}` e `p{text-wrap:pretty}` em `@layer base`.
- Teste: `tests/unit/client/skeleton.test.tsx`, mais as asserções novas em `tests/unit/client/site-header.test.tsx`.

**Interfaces:**
- Produz: `export function Skeleton(props: { className?: string; label?: string }): JSX.Element`. É um `role="status"` com `aria-label={label ?? "Carregando"}` e as classes `animate-pulse motion-reduce:animate-none`.

- [ ] **Passo 1:** teste `Skeleton respeita movimento reduzido`: a classe contém `motion-reduce:animate-none`, e `role=status` aparece com o nome "Carregando". Mais o teste `links do rodapé têm min-h-11`.
- [ ] **Passo 2:** rodar. Deve FALHAR.
- [ ] **Passo 3: implementar** e trocar os skeletons inline por `<Skeleton className=…/>`.
- [ ] **Passo 4:** `pnpm test` passa. Conferir com `rg "animate-pulse" components`: as únicas ocorrências devem estar em `skeleton.tsx`.
- [ ] **Passo 5:** commit `fix(a11y): alvos de 44px, skeleton com movimento reduzido e títulos balanceados`.

## Fase 2 — Navegação mobile

### Task 5: Navegação compartilhada (`nav.ts` + `NavLink`)

**Arquivos:**
- Criar: `components/layout/nav.ts`, `components/layout/NavLink.tsx`
- Modificar: `components/layout/SiteHeader.tsx`, `components/layout/LocalHeader.tsx`
- Teste: `tests/unit/client/nav.test.tsx`

**Interfaces:**
- Produz:

```ts
export type NavId = "vagas" | "minhas-vagas" | "perfil" | "configuracoes" | "apoie" | "fontes" | "privacidade";
export const PRIMARY_NAV: readonly { id: NavId; label: string; href: string }[]; // vagas, minhas-vagas, perfil, configuracoes
export const MORE_NAV: readonly { id: NavId; label: string; href: string; hint?: string }[]; // configuracoes, fontes, apoie, privacidade
export function isLocalRoute(href: string): href is LocalRoute;
export function navItemForPath(pathname: string): NavId | undefined;
export function NavLink(props: { href: string; current?: boolean } & AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element;
```

- [ ] **Passo 1: testes.**
  - `isLocalRoute`: `true` para `/perfil`, `/configuracoes`, `/minhas-vagas` e `/gerador/12`; `false` para `/`, `/apoie`, `/fontes` e `/vagas/3`.
  - `navItemForPath`: `/configuracoes/callback` → `configuracoes`; `/gerador/9` → `undefined`.
  - `NavLink` para `/perfil` renderiza um `<a>` sem `data-nextjs-link`: mockar `next/link` e checar que ele não foi chamado.
- [ ] **Passo 2:** rodar. Deve FALHAR.
- [ ] **Passo 3: implementar.**
  - Mover o `NAV` e o `NavLink` de `SiteHeader.tsx` para os novos arquivos.
  - "Apoie" sai do nav principal do desktop e vai para um link discreto à direita do header (spec D-06/P-05).
  - O `LocalHeader` passa a usar `navItemForPath`.
- [ ] **Passo 4:** `pnpm test` passa e `site-header.test.tsx` continua verde.
- [ ] **Passo 5:** commit `refactor(layout): navegação compartilhada com regra Link/HardLink`.

### Task 6: Barra de abas, "Mais", `AppShell` e toasts acima da barra

**Arquivos:**
- Criar: `components/layout/MobileTabBar.tsx`, `components/layout/MoreSheet.tsx`, `components/layout/AppShell.tsx`
- Modificar:
  - `app/(local)/layout.tsx`, `app/(site)/page.tsx`, `app/(site)/vagas/[id]/page.tsx` e as demais páginas `(site)` que montam `SiteHeader`;
  - `SiteHeader.tsx` (abaixo de `md`: 56px, só logo e tema; nav com `hidden md:flex`);
  - `SiteFooter.tsx` (`hidden md:block`);
  - `components/ui/sonner.tsx` e `JobsPage.tsx:260` (posição do "Desfazer").
- Teste: `tests/unit/client/mobile-tab-bar.test.tsx`

**Interfaces:**
- Consome: `PRIMARY_NAV`, `MORE_NAV`, `NavLink` e `navItemForPath` (Tarefa 5); `Sheet` (Tarefa 3); `ThemeToggle`.
- Produz:
  - `export function AppShell(props: { current?: NavId; tabBar?: boolean; children: React.ReactNode }): JSX.Element`. Com `tabBar={false}`, a página monta a própria barra de ação (vaga, gerador).
  - A classe utilitária `pb-tabbar` no `<main>`: `padding-bottom: calc(72px + env(safe-area-inset-bottom))` abaixo de `md`.

- [ ] **Passo 1: testes que falham.**
  - `renderiza 4 abas com aria-current na rota atual`.
  - `Minhas vagas mostra contador de vagas salvas`: o contador vem de `jobStateStore`; montar com 2 vagas salvas e esperar "2".
  - `Mais abre sheet com Configurações de IA, Dados e backup, Fontes de vagas, Guia de início, Apoie o projeto, Privacidade e o seletor de tema Claro/Escuro/Sistema`.
  - `barra recebe classe que a oculta quando um campo de texto tem foco` (Foco de revisão 2): o elemento `nav` tem a classe `[body:has(input:focus,textarea:focus)_&]:hidden` ou equivalente.
- [ ] **Passo 2:** rodar. Deve FALHAR.
- [ ] **Passo 3: implementar.**
  - **Barra:** visível só abaixo de `md` (`md:hidden`), `fixed bottom-0`, 64px + safe-area, ícones lucide de 22px e rótulo de 11px/600. A aba ativa usa `text-jf-brand` com uma pílula `bg-jf-brand-soft`.
  - **Toasts:** `Toaster` com `mobileOffset={{ bottom: "calc(80px + env(safe-area-inset-bottom))" }}`. O "Desfazer" de `JobsPage` passa a `bottom-[calc(80px+env(safe-area-inset-bottom))] md:bottom-4`.
- [ ] **Passo 4:** `pnpm test && pnpm build` passam.
- [ ] **Passo 5:** commit `feat(mobile): barra de abas inferior, menu Mais e AppShell`.

### Task 7: Projetos Playwright mobile e spec de navegação

**Arquivos:**
- Modificar: `playwright.config.ts`
- Criar: `tests/e2e/mobile-nav.spec.ts`

**Interfaces:**
- Produz:
  - os projetos `desktop` (todos os specs atuais), `mobile-pixel` (`devices["Pixel 7"]`) e `mobile-iphone` (`{ ...devices["iPhone 13"], browserName: "chromium" }`, sem exigir o WebKit instalado);
  - os projetos mobile só rodam `testMatch: /mobile-.*\.spec\.ts/`.

- [ ] **Passo 1:** escrever `mobile-nav.spec.ts`.
  - `barra de abas visível e header de uma linha`: `nav[aria-label=Principal]` visível com 4 links, e o header com altura ≤ 56.
  - `aba Perfil abre /perfil sem violação de CSP`: coletar `page.on("console")` e `securitypolicyviolation`, clicar em Perfil, esperar a URL `/perfil` e checar 0 violações.
  - `primeiro card visível sem rolar` (RF-01): o `boundingBox()` do 1º `article` tem `y + 120 < 844`.
- [ ] **Passo 2:** `pnpm test:e2e --project=mobile-pixel` deve passar. Se falhar, a causa está nas Tarefas 4 a 6; não afrouxe a asserção.
- [ ] **Passo 3:** `pnpm test:e2e --project=desktop` continua verde.
- [ ] **Passo 4:** commit `test(e2e): projetos mobile e navegação pela barra de abas`.

## Fase 3 — Lista de vagas

### Task 8: Progresso de setup e retorno seguro à vaga

**Arquivos:**
- Criar: `lib/client/setup/progress.ts`, `components/onboarding/SetupProgress.tsx`
- Modificar: `components/profile/ProfileScreen.tsx`, `components/settings/AiSettingsScreen.tsx` (link "Voltar para a vaga" quando há `?voltar` válido)
- Teste: `tests/unit/client/setup-progress.test.ts`, `tests/unit/client/setup-progress-ui.test.tsx`

**Interfaces:**
- Consome: `aiSettingsStore` (`lib/client/ai/settings.ts:70`), `profileStore` (`lib/client/profile/store.ts:7`) e `useStore`.
- Produz:

```ts
export type SetupProgress = { aiReady: boolean; cvReady: boolean; step: 1 | 2 | 3 }; // step 3 = pronto
export function getSetupProgress(ai: AiSettings | null, profile: Profile | null): SetupProgress;
export function safeReturnPath(raw: string | null | undefined): string | null; // só /vagas/<n> ou /gerador/<n>
export function withReturn(href: LocalRoute, returnTo: string | null): string;
export function SetupProgress(props: { variant: "banner" | "card" | "inline"; returnTo?: string }): JSX.Element | null; // null quando step === 3
```

- **Regra de "IA pronta":** `aiReady` = pelo menos uma entrada em `ai.providers`.
- **Regra de "currículo pronto":** `cvReady` = `profile !== null`.

- [ ] **Passo 1: testes que falham.**
  - `getSetupProgress`: os quatro casos, `(null,null)→1`, `(ai,null)→2`, `(null,profile)→1` e `(ai,profile)→3`.
  - `safeReturnPath` aceita `/vagas/4059` e `/gerador/12`.
  - Rejeita, com `null`: `//evil.com`, `https://x.com/vagas/1`, `/vagas/../perfil`, `/vagas/1?x=1`, `javascript:alert(1)`, `/vagas/abc` e `""` (Foco de revisão 1).
  - UI: no `banner` com step 2, o texto é "Veja sua chance em cada vaga", o contador "2/3" e o link "Importar currículo" aponta para `/perfil?voltar=%2Fvagas%2F4059` quando `returnTo="/vagas/4059"`. Com step 3, não renderiza nada.
- [ ] **Passo 2:** rodar. Deve FALHAR.
- [ ] **Passo 3: implementar.** `safeReturnPath` com `^/(vagas|gerador)/\d+$`. Copy exata do banner com step 2: "IA conectada. Falta importar seu currículo (PDF do LinkedIn ou DOCX) — leva 1 minuto."
- [ ] **Passo 4:** os testes passam.
- [ ] **Passo 5:** commit `feat(setup): progresso de setup com retorno seguro à vaga`.

### Task 9: Lista sem CTA repetido e indicador de setup no header

**Arquivos:**
- Modificar:
  - `components/jobs/ChanceBadge.tsx` (`band === null` → `null`);
  - `components/jobs/JobsPage.tsx` (um `<SetupProgress variant="banner"/>` acima da lista);
  - `components/jobs/FiltersPanel.tsx:89-108` (sem perfil: o grupo Chance vira uma linha de convite);
  - `SiteHeader.tsx` (indicador "IA conectada · Currículo pendente" a partir de `lg`).
- Teste: `tests/unit/client/chance-ui.test.tsx`, `tests/e2e/chance.spec.ts`

**Interfaces:**
- Consome: `SetupProgress` e `getSetupProgress` (Tarefa 8).

- [ ] **Passo 1:** testes.
  - Trocar a asserção antiga do convite por `ChanceBadge com band null não renderiza`.
  - `lista sem perfil mostra exatamente 1 convite de importar` (`getAllByText(/importar currículo/i)` com tamanho 1).
- [ ] **Passo 2:** rodar. Deve FALHAR.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `pnpm test && pnpm test:e2e tests/e2e/chance.spec.ts` passam. Atualizar os seletores do E2E que procuravam a pílula.
- [ ] **Passo 5:** commit `feat(jobs): convite único de setup no lugar da pílula por card`.

### Task 10: Card de vaga com uma ação e menu "⋯"

**Arquivos:**
- Criar: `components/jobs/JobCardMenu.tsx`
- Modificar: `components/jobs/JobCard.tsx:88-117`, `components/jobs/JobActions.tsx`
- Teste: `tests/unit/components/jobs.test.tsx`; E2E `home-extras.spec.ts` e `my-jobs.spec.ts`

**Interfaces:**
- Consome: as funções de status e ocultar que já existem em `JobActions.tsx` (mantidas).
- Produz: `export function JobCardMenu(props: { jobId: number; jobUrl: string; status: JobStatus | null; onHide: () => void }): JSX.Element`, sobre `@base-ui/react/menu`, com os itens "Mudar status" (submenu com os `JOB_STATUSES`), "Ocultar vaga" e "Copiar link".

- [ ] **Passo 1:** testes.
  - `card tem um só link e ele cobre o card`: o link do título tem a classe `after:absolute after:inset-0`.
  - `só a estrela e o menu ficam visíveis`: não existe `combobox` de status no card.
  - `menu ⋯ oferece Mudar status, Ocultar vaga e Copiar link`.
  - `Ocultar vaga pelo menu mostra Desfazer`.
- [ ] **Passo 2:** rodar. Deve FALHAR.
- [ ] **Passo 3: implementar.**
  - **Celular:** card de cerca de 160px, chips limitados a 3 + "+n" via prop `maxTags` em `StackChips`, e estrela de 44px no canto superior direito.
  - **Desktop:** estrela de 40px + "⋯".
- [ ] **Passo 4:** `pnpm test && pnpm test:e2e tests/e2e/home-extras.spec.ts tests/e2e/my-jobs.spec.ts` passam, com os seletores atualizados para abrir o menu.
- [ ] **Passo 5:** commit `feat(jobs): card clicável com estrela e menu de ações`.

### Task 11: Topo compacto, filtros em sheet e barra de resultados

**Arquivos:**
- Criar: `components/jobs/ResultsToolbar.tsx`, `components/jobs/ActiveFilterChips.tsx`
- Modificar:
  - `components/jobs/JobsPage.tsx:108` ("Limpar filtros" preserva `q`) e `:137` (botão Filtros);
  - `components/jobs/FiltersPanel.tsx:50` (sai o `hidden/flex`; recebe as props `period` e `onPeriodChange` só para o modo sheet);
  - `components/jobs/SearchBar.tsx` (fonte de 16px no celular; o período sai do celular);
  - `components/jobs/ModeTabs.tsx:63` (contagens visíveis);
  - `components/jobs/LinkedInSearchLink.tsx` (posição: fim da lista).
- Teste: `tests/unit/client/jobs/results-toolbar.test.tsx`, `tests/e2e/home.spec.ts`, `tests/e2e/home-extras.spec.ts`

**Interfaces:**
- Consome: `Sheet` (Tarefa 3).
- Produz:
  - `export function ResultsToolbar(props: { activeCount: number; total: number; onOpenFilters: () => void }): JSX.Element`. Sticky abaixo de `lg`, com "Filtros (n) · N vagas · modo ▾".
  - `export function ActiveFilterChips(props: { chips: { key: string; label: string; onRemove: () => void }[]; onClearAll: () => void }): JSX.Element`.

- [ ] **Passo 1:** testes.
  - `Limpar filtros mantém a busca` (Foco de revisão 5): com `q=react` e `seniority=pleno`, depois de limpar, a URL tem `q=react` e não tem `seniority`.
  - `ResultsToolbar mostra Filtros (2) e 1.284 vagas`.
  - `sheet de filtros fecha quando lg passa a valer` (Foco de revisão 3): mockar `matchMedia("(min-width: 1024px)")` disparando `change` com `matches: true`, e esperar o dialog sumir.
  - `rodapé do sheet mostra Ver N vagas com contagem ao vivo`.
- [ ] **Passo 2:** rodar. Deve FALHAR.
- [ ] **Passo 3: implementar** conforme o canvas: `Main.dc.html` no desktop, `Mobile-Vagas` e `Mobile-Filtros` no celular. O aviso de coleta atrasada vira texto âmbar no subtítulo, com o link "por quê?" para `/fontes`.
- [ ] **Passo 4:** `pnpm test && pnpm test:e2e --project=desktop tests/e2e/home.spec.ts tests/e2e/home-extras.spec.ts && pnpm test:e2e --project=mobile-pixel` passam. Acrescentar ao `home.spec.ts` (desktop, 1440×900) a asserção RF-01 `primeiro card começa acima de y=600`.
- [ ] **Passo 5:** commit `feat(jobs): topo compacto, filtros em sheet e chips de filtros ativos`.

**Fora deste plano (desvio registrado da spec D-04):** a ordenação "Maior chance". A lista é paginada no servidor e a chance é calculada no cliente: ordenar só a página carregada daria um resultado enganoso. Fica como pergunta para uma próxima spec.

## Fase 4 — Vaga e gerador

### Task 12: Detalhe da vaga com "Sua aderência" e barra de ação

**Arquivos:**
- Criar: `components/jobs/JobDetailActionBar.tsx`
- Modificar: `components/jobs/JobDetail.tsx:191,301-303`, `components/jobs/AiAnalysis.tsx`, `lib/client/render-html.ts`
- Teste: `tests/unit/client/job-detail.test.tsx`, `tests/unit/client/render-html.test.ts`, `tests/e2e/job-detail.spec.ts`

**Interfaces:**
- Consome: `SetupProgress variant="card"` (Tarefa 8), `AppShell tabBar={false}` (Tarefa 6) e `JobCardMenu` (Tarefa 10, usado no header do celular).
- Produz:
  - `export function JobDetailActionBar(props: { jobId: number; applyUrl: string; sourceName: string; canGenerate: boolean }): JSX.Element`, só abaixo de `md`;
  - `toSafeHtml` passa a aceitar `{ paragraphs?: boolean }`, que quebra linhas duplas em `<p>`.

- [ ] **Passo 1:** testes.
  - `pedido de currículo aparece uma vez no detalhe sem perfil`.
  - `Gerar CV fica desabilitado e diz o motivo sem perfil`: `toBeDisabled` com o nome "Gerar CV + carta · precisa do currículo".
  - `CTA Candidatar-se cabe em uma linha`: a classe contém `whitespace-nowrap`.
  - `toSafeHtml com paragraphs transforma \n\n em <p>`.
- [ ] **Passo 2:** rodar. Deve FALHAR.
- [ ] **Passo 3: implementar** conforme `Desktop-Vaga.dc.html` e `Mobile-Vaga.dc.html`.
  - Descrição com `max-w-[70ch]`.
  - No desktop, coluna direita sticky com estes blocos: Candidatar-se na fonte; Salvar + status; Gerar CV; Ocultar; "Sua aderência".
  - No celular, abas "Sobre a vaga | Análise com IA" e a barra fixa.
- [ ] **Passo 4:** `pnpm test && pnpm test:e2e tests/e2e/job-detail.spec.ts tests/e2e/analysis.spec.ts` passam.
- [ ] **Passo 5:** commit `feat(vaga): card Sua aderência, CTA claro e barra de ação no celular`.

### Task 13: Gerador no celular com pré-visualização em canvas

**Arquivos:**
- Modificar:
  - `components/generator/PdfPreview.tsx` (prop `mode`);
  - `components/generator/GeneratorScreen.tsx:390,411` (abas Editar/Pré-visualizar abaixo de `lg` e barra "Gerar de novo · Baixar PDF");
  - `components/generator/GeneratorToolbar.tsx`;
  - `components/generator/TailoredEditor.tsx` (campos com `text-base` no celular).
- Teste: `tests/unit/client/pdf-preview.test.tsx`, `tests/e2e/generator.spec.ts`

**Interfaces:**
- Produz: `PdfPreview` com a prop `mode?: "iframe" | "canvas"`. O padrão é `"canvas"` abaixo de `lg` (via `matchMedia`) e `"iframe"` a partir de `lg`. No modo canvas, desenha cada página com `getDocument` de `unpdf/pdfjs` (o mesmo import de `lib/client/extract/extract-core.ts:53`) em `<canvas aria-label="Página N do PDF">` e mostra o link "Abrir PDF em tela cheia" (`target="_blank"` na URL `blob:`).

- [ ] **Passo 1:** testes com `unpdf/pdfjs` mockado (2 páginas).
  - `modo canvas renderiza 2 canvas com rótulos Página 1 e Página 2 do PDF`.
  - `modo canvas oferece Abrir PDF em tela cheia`.
  - `falha do pdfjs cai para o link de abrir o PDF com aviso`.
- [ ] **Passo 2:** rodar. Deve FALHAR.
- [ ] **Passo 3: implementar** conforme `Mobile-Gerador.dc.html`. Escala do canvas = largura do contêiner ÷ largura da página × `devicePixelRatio`.
- [ ] **Passo 4:** `pnpm test && pnpm test:e2e tests/e2e/generator.spec.ts` passam. Acrescentar `tests/e2e/mobile-generator.spec.ts`: no Pixel 7, a aba Pré-visualizar mostra um `canvas` visível. Rodar com `--project=mobile-pixel`.
- [ ] **Passo 5:** commit `feat(gerador): abas e pré-visualização em canvas no celular`.

## Fase 5 — Minhas vagas, Configurações, Perfil e Fontes

Pode rodar em paralelo à Fase 3: os arquivos são diferentes.

### Task 14: Minhas vagas como funil

**Arquivos:**
- Modificar: `components/my-jobs/Board.tsx:10-17,56`, `components/my-jobs/Column.tsx`, `components/my-jobs/JobMiniCard.tsx`
- Teste: `tests/unit/client/my-jobs-board.test.tsx` (novo), `tests/e2e/my-jobs.spec.ts`

**Interfaces:**
- Produz:
  - `export const STAGES = [{ id: "saved", label: "Salvas" }, { id: "applied", label: "Aplicadas" }, { id: "interview", label: "Entrevista" }, { id: "offer", label: "Proposta" }] as const;`
  - "Recusadas" e "Ocultas" viram links secundários "Recusadas (n)" e "Ocultas (n)", que abrem a lista filtrada na mesma tela (premissa até a P-02 da spec ser respondida).
  - "Favoritas" vira o checkbox "Só favoritas".

- [ ] **Passo 1:** testes.
  - `desktop mostra 4 colunas com contadores`.
  - `Só favoritas filtra as 4 colunas`.
  - `coluna vazia mostra o texto de ajuda`.
  - `celular: seletor segmentado troca a etapa e o botão Mover abre os status`.
- [ ] **Passo 2:** rodar. Deve FALHAR.
- [ ] **Passo 3: implementar** conforme `Desktop-MinhasVagas` e `Mobile-MinhasVagas`. A partir de `lg`, grade de 4 colunas; abaixo de `lg`, seletor segmentado (`role=tablist`, setas e Home/End iguais às de hoje).
- [ ] **Passo 4:** `pnpm test && pnpm test:e2e tests/e2e/my-jobs.spec.ts` passam.
- [ ] **Passo 5:** commit `feat(minhas-vagas): funil Salvas → Aplicadas → Entrevista → Proposta`.

### Task 15: Configurações em lista e diálogos em sheet no celular

**Arquivos:**
- Modificar: `components/settings/AiSettingsScreen.tsx`, `ProviderCard.tsx`, `AddKeyDialog.tsx`, `ModelPickerDialog.tsx`, `BackupSection.tsx`, `components/ui/dialog.tsx`
- Teste: `tests/unit/client/ai-settings-screen.test.tsx`, `provider-card.test.tsx`, `tests/e2e/settings.spec.ts`

**Interfaces:**
- Produz: `DialogContent` ganha a prop `mobile?: "sheet" | "center"`, com padrão `"sheet"`. Abaixo de `sm`, usa as classes do `Sheet side="full"`, com o campo no topo e `max-h-dvh`.

- [ ] **Passo 1:** testes.
  - `só o OpenRouter tem botão primário`: exatamente 1 botão com classe de `BTN_PRIMARY` entre os provedores.
  - `Modelo por tarefa fica oculto sem provedor conectado`.
  - `título da página é Configurações e há a seção Dados e backup`.
- [ ] **Passo 2:** rodar. Deve FALHAR.
- [ ] **Passo 3:** implementar. No celular, os provedores viram linhas de 56px com nome, status e "›", que abrem um sheet.
- [ ] **Passo 4:** `pnpm test && pnpm test:e2e tests/e2e/settings.spec.ts` passam.
- [ ] **Passo 5:** commit `feat(configuracoes): provedor recomendado em destaque e diálogos em sheet no celular`.

### Task 16: Perfil, Fontes e Apoie

**Arquivos:**
- Modificar: `components/profile/ImportPanel.tsx`, `components/sources/SourcesPage.tsx`, `app/(site)/apoie/page.tsx`
- Teste: `tests/unit/client/import-panel.test.tsx`, `donation.test.tsx`, `tests/e2e/sources.spec.ts`

- [ ] **Passo 1:** testes.
  - `com ponteiro de toque o texto é Toque para escolher o PDF ou DOCX`: mockar `matchMedia("(pointer: coarse)")`.
  - `Fontes mostra um banner global quando todas estão atrasadas e não 1 alerta por fonte`.
  - `Apoie no celular mostra Copiar Pix copia e cola antes do QR`.
- [ ] **Passo 2:** rodar. Deve FALHAR.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `pnpm test && pnpm test:e2e tests/e2e/sources.spec.ts tests/e2e/profile.spec.ts` passam.
- [ ] **Passo 5:** commit `feat(ui): textos de toque no perfil, banner global em fontes e Pix primeiro`.

## Fase 6 — Botões unificados

### Task 17: `buttonVariants` como fonte única

**Arquivos:**
- Modificar: `components/ui/button.tsx`, `components/ui/styles.ts`
- Teste: `tests/unit/client/button-variants.test.ts` (novo)

**Interfaces:**
- Produz:
  - `buttonVariants({ variant: "primary" | "outline" | "ghost" | "danger" | "link", size: "md" | "sm" | "icon" })`. `md` = `min-h-11` no celular e `md:min-h-9` no desktop.
  - `styles.ts` exporta `BTN_PRIMARY = buttonVariants({ variant: "primary" })` e `BTN_OUTLINE = buttonVariants({ variant: "outline" })`. Os chamadores não mudam.

- [ ] **Passo 1:** teste `BTN_PRIMARY e Button variant primary geram as mesmas classes`, mais `primary usa text-jf-on-brand e ring jf-brand`.
- [ ] **Passo 2:** rodar. Deve FALHAR.
- [ ] **Passo 3:** implementar. Remover as variantes shadcn que nada usa (`secondary`, `xs`, `icon-xs`); conferir com `rg` antes.
- [ ] **Passo 4:** `pnpm test && pnpm build && pnpm test:e2e --project=desktop` passam.
- [ ] **Passo 5:** commit `refactor(ui): buttonVariants como fonte única dos botões`.

---

## Ordem e paralelismo

| Tarefas | Depende de | Pode rodar junto com |
|---|---|---|
| 1, 2, 3, 4 | — | entre si (arquivos distintos; a 4 toca `dialog.tsx`, a 3 só o lê) |
| 5 → 6 → 7 | 3 (a 6) | 8 |
| 8 → 9 → 10 → 11 | 3, 6 | 14, 15, 16, 17 |
| 12 → 13 | 8, 6, 10 | 14–17 |
| 14, 15, 16 | 3, 6 | entre si e com a Fase 3 |
| 17 | 1 | Fases 3 a 5, desde que nenhuma tarefa em curso mexa em `styles.ts` |

**Caminho crítico:** 1 → 3 → 6 → 8 → 11 → 12 → 13.

## Cobertura da spec

| Requisito | Tarefas |
|---|---|
| RF-01 | 7, 11 |
| RF-02 | 8, 9, 12 |
| RF-03 | 5, 6 |
| RF-04 | 3, 11 |
| RF-05 | 12 |
| RF-06 | 13 |
| RF-07 | 10 |
| RNF-01 | 1, 4 |
| RNF-02 | 4, 6, 10, 11 |
| RNF-03 | 2, 6 |
| RNF-04 | 13 (sem dependência nova) |

Decisões da spec: D-01 → 1, D-02 → 17, D-03 → 8 e 9, D-04 → 11 (sem ordenação), D-05 → 10, D-06 → 5 a 7, D-07 → 13, D-08 → 12, D-09 → 14, D-10 → 15 e 16, D-11 → 2 e 4.
