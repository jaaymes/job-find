# Spec técnica: Fase 1. Glassdoor da empresa, filtros persistentes e aviso de perfil não salvo

- **Data:** 2026-11-25
- **Origem:** [PRD 2026-11-25](../prd/2026-11-25-glassdoor-filtros-ia-perfil-templates-cv.md), Fase 1: RF-01..04, RF-10..14, RF-26 e o spike Q-01.
- **Tamanho:** pequeno a médio, só front-end. Não há rota, tabela nem contrato de API novos.
- **Especialistas:** não houve convocação em paralelo. A mudança fica toda em módulos de cliente que já seguem padrões repetidos no código (`createStore`, nuqs, `linkedin-search.ts`), e a superfície de segurança é um link externo.

## 1. Como o código está hoje (fatos)

- Os filtros são lidos e gravados na URL com nuqs (`lib/client/jobs/use-jobs.ts:32-66`, `useQueryStates` com `urlKeys: { showHidden: "ocultas" }`).
- A busca padrão (`lib/client/jobs/saved-search.ts`) usa `createStore("jobfind:v1:savedFilters")`. `useApplySavedSearch` aplica a busca padrão só na montagem e só se a URL não tem filtros. Ele devolve `ready` para a consulta não sair sem filtros (`JobsPage.tsx:93-95`).
- Links que levam de volta à lista sem filtros:

  | Onde | Arquivo | Componente |
  |---|---|---|
  | "← Voltar para as vagas" (desktop) | `components/jobs/JobDetail.tsx:39-45` | `BackLink`, `next/link` para `/` |
  | Seta voltar (celular) | `components/jobs/JobDetail.tsx:324-331` | `MobileTopBar` |
  | "Ver todas as vagas" (vaga não encontrada) | `components/jobs/JobDetail.tsx:126-131` | `NotFound` |
  | Logo | `components/layout/SiteHeader.tsx:12` | server component |
  | Item "Vagas" do header | `components/layout/nav.ts:7` + `NavLink` | server component |
  | Aba "Vagas" do celular | `components/layout/MobileTabBar.tsx:19` | client component |

- As rotas `(local)` (`/perfil`, `/minhas-vagas`, `/configuracoes`, `/gerador/*`) são abertas com navegação completa (`HardLink`, por causa da CSP). Portanto, ao voltar delas para `/`, o estado do React Query também já foi perdido.
- O `ProfileEditor` mantém um rascunho em memória (`useState(profile)`) e só grava ao clicar em "Salvar perfil". Hoje não há nenhum aviso ao sair (`components/profile/ProfileEditor.tsx:26-33`).
- `JobOrigin` é `"national" | "international" | "unknown"` (`lib/shared/types/job.ts:9`).
- `@base-ui/react` 1.9 exporta `Menu.LinkItem`, usado no menu ⋯.

## 2. Spike Q-01: URL do Glassdoor

- Testamos `https://www.glassdoor.com.br/Search/results.htm?keyword=Nubank` no navegador embutido. O Glassdoor respondeu com a verificação "Somente humanos" do Cloudflare (HTTP 403 para automação) e registrou a URL pedida, sem 404. Não completamos a verificação (CAPTCHA), porque a regra é não contorná-la.
- Páginas de empresa (`/Reviews/<Nome>-Reviews-E<id>.htm`) exigem o ID interno, que só se obtém consultando o Glassdoor. Isso está fora de questão (RN-10).
- **Decisão:** usar `https://www.glassdoor.com.br/Search/results.htm?keyword=<nome>` para vaga nacional ou de origem desconhecida, e `https://www.glassdoor.com/Search/results.htm?keyword=<nome>` para internacional.
- **Confirmado (P-01, 2026-11-25):** o mantenedor abriu a URL num navegador comum e ela mostra a busca de empresas. O fallback do Google fica registrado só como plano B.

## 3. Decisões

### D-01. Glassdoor: função pura e dois pontos de UI (RF-01..04)

- Novo `lib/client/jobs/glassdoor.ts`, seguindo o padrão de `linkedin-search.ts`:
  - `normalizeCompanyForSearch(name: string): string | null` remove o conteúdo entre parênteses e os sufixos societários no fim do nome (`Ltda`, `Ltda.`, `S.A.`, `S/A`, `SA`, `ME`, `EPP`, `EIRELI`, `Inc`, `Inc.`, `LLC`, `Ltd`, `Ltd.`, `GmbH`, `Corp`, `Corp.`, `Co.`, sem diferenciar maiúsculas, repetindo até estabilizar). Também tira vírgula e espaços sobrando. Devolve `null` quando o resultado tem menos de 2 caracteres ou é genérico.
  - Lista de genéricos (comparada sem acento e em minúsculas): `confidencial`, `empresa confidencial`, `confidential`, `stealth`, `stealth startup`, `undisclosed`, `empresa`, `n/a`, `nao informado`.
  - `buildGlassdoorUrl(company: string, origin: JobOrigin): string | null` monta a URL com `URLSearchParams` (que cuida dos acentos e do `&`).
- UI:
  - `JobDetail.tsx`: na linha `{job.company} · {placeLabel(job)}`, o nome da empresa continua texto e ganha ao lado um link "Glassdoor" com ícone `ExternalLink` do lucide e nome acessível "Ver <empresa> no Glassdoor (abre em nova aba)". Usa `target="_blank"`, `rel="noopener noreferrer nofollow"` e alvo de toque ≥ 44 px (classe `LINK` existente com `min-h-11`).
  - `JobCardMenu.tsx`: nova prop opcional `glassdoorUrl?: string | null`. Quando há URL, mostra `Menu.LinkItem` "Ver empresa no Glassdoor", abrindo em nova aba, entre "Copiar link" e "Ocultar". O `JobCard` e o `MobileTopBar` passam `buildGlassdoorUrl(job.company, job.origin)`.
- Segurança: o host é fixo e o nome vai só em query string codificada. Não precisa de `safeExternalUrl`, mas o teste confere que a origem é sempre `https://www.glassdoor.com(.br)`. A CSP não muda (é navegação, não `connect-src`).

### D-02. Última busca: nova store no localStorage (RF-10)

- Em `lib/client/jobs/saved-search.ts`:
  ```ts
  const LastFilters = z.object({ filters: SavedFilters, savedAt: z.iso.datetime() });
  export const lastFiltersStore = createStore("jobfind:v1:lastFilters", LastFilters.nullable(), { version: 1, initial: null });
  export const LAST_FILTERS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  ```
  Mais a entrada `"jobfind:v1:lastFilters"` em `StorageKey` (`lib/client/storage/keys.ts`).
- **Sem `showHidden`** (RN-16): `toSavedFilters` já o descarta.
- **Fora do backup** (`BACKUP_KEYS`): é estado efêmero de navegação. A busca padrão continua no backup.
- **Gravação:** um `useEffect` no `JobsPage` (ou `useRememberFilters(filters, ready)` em `saved-search.ts`) roda quando `ready` é verdadeiro e os filtros mudam:
  - `toSavedFilters(filters)`; se `null`, grava `null`;
  - senão, grava `{ filters, savedAt: now }`, mas só se o JSON dos filtros for diferente do que já está salvo (não regrava o `savedAt` a cada render).
- **Sem debounce (desvio consciente do RNF-02 do PRD):** os filtros mudam por clique ou envio, não a cada tecla (`SearchBar` só grava no submit), e a escrita é síncrona e pequena. O debounce criaria uma janela em que fechar a aba perde a última mudança.
- **Gate em `ready`:** na montagem sem query, `filters` é `{}` antes da restauração. Sem o gate, o efeito gravaria `null` por cima da última busca.
- "Limpar tudo" e remover filtro por filtro até zerar têm o mesmo efeito: grava `null`, e na próxima visita vale a busca padrão (RN-15). Isso fica documentado na spec. Distinguir os dois casos não vale a complexidade.

### D-03. Precedência na abertura (RF-13, RF-14)

`useApplySavedSearch` vira `useRestoreFilters(filters, setFilters): { ready: boolean; restored: "last" | "saved" | null; dismiss(): void }`, com a mesma mecânica de hoje (decisão no `useState` inicial, aplicação via `setFilters` no efeito de montagem, `ready` falso até a URL refletir a restauração).

1. A URL tem algum parâmetro de filtro (`hasFilterParams`): não restaura nada.
2. `lastFiltersStore` válido, com `now - savedAt ≤ 7 dias` e `toSavedFilters(...) !== null`: aplica e marca `restored = "last"`.
3. Busca padrão válida: aplica e marca `restored = "saved"`. Isso preserva o comportamento atual, agora como terceira opção.
4. Caso contrário: lista sem filtros.

**Aviso (RF-14):** quando `restored === "last"`, o `JobsPage` mostra acima dos chips uma linha `role="status"`: "Busca da última visita restaurada · Limpar". O botão "Limpar" chama o `clear()` existente. O aviso some na primeira mudança de filtro (estado local `noticeFor = serialização dos filtros restaurados`; esconde quando a serialização atual difere). A busca padrão restaurada continua sem aviso, como hoje.

### D-04. Links para a lista carregam os filtros (RF-11)

- `lib/client/jobs/use-jobs.ts`: exportar `serializeFilters = createSerializer(urlParsers, { urlKeys: URL_KEY_OVERRIDES })` do nuqs. É o mesmo parser da página, então a URL gerada é idêntica à que `setState` produziria.
- Novo hook `useJobsListHref(): string` em `lib/client/jobs/list-href.ts`. Ele lê `useStore(lastFiltersStore)` e devolve `"/"` quando a store é `null`, está expirada ou ainda não hidratou (servidor e primeiro render). Senão devolve `serializeFilters("/", filters)`.
- Novo client component `components/jobs/JobsListLink.tsx` (`"use client"`), um `next/link` com `href={useJobsListHref()}` que aceita `className`, `children` e `aria-*`.
- Onde trocar:
  - logo e item "Vagas" no `SiteHeader`: o header é server component, então só esses dois links viram `JobsListLink`. O `NavLink` ganha uma variante via prop `hrefOverride` ou o item "Vagas" é renderizado à parte; a escolha fica para a implementação, mantendo o estilo de `NavLink`;
  - aba "Vagas" no `MobileTabBar` (já é client): `href` vem do hook;
  - `NotFound` do detalhe: `JobsListLink`.
- Hidratação: no SSR o href é `/`, e depois da hidratação vira `/?...`. Não há mismatch de texto, só do atributo após o efeito, porque `useStore` devolve `null` no servidor e na hidratação (é o mesmo padrão que o app já usa).
- Na própria home, o logo aponta para a última busca, que é a busca atual. Clicar nele não muda nada, o que é aceitável.

### D-05. "Voltar" volta no histórico quando veio da lista (RF-12)

- Ao clicar no título do `JobCard` sem modificador (sem ctrl, meta, shift nem botão do meio), grava em `sessionStorage["jobfind:session:listReturn"] = { jobId }`. Isso fica num helper `markListReturn(jobId)` em `list-href.ts`, com try/catch.
- `BackLink` (desktop) e a seta do `MobileTopBar` viram um componente `BackToJobsLink`:
  - renderiza `next/link` com `href={useJobsListHref()}`, o que preserva o clique do meio e o "abrir em nova aba";
  - no `onClick` sem modificador: se `listReturn.jobId === job.id` **e** `window.history.length > 1`, faz `preventDefault()` e `router.back()`. Senão, segue o link. Nos dois casos remove a entrada da sessionStorage.
- `router.back()` devolve a lista com rolagem, páginas carregadas ("Carregar mais") e cache do React Query (`staleTime` de 60 s, `gcTime` padrão de 5 min). Dentro de rotas públicas a navegação é client-side, então o estado fica em memória.
- Casos de borda:
  - vaga aberta em nova aba: `history.length === 1`, então cai no link com a última busca;
  - vaga aberta por link compartilhado: não há `listReturn`, então vai para a última busca;
  - detalhe recarregado (F5): o histórico continua e a sessionStorage também, então `back()` funciona;
  - fluxo lista → vaga A → gerador (navegação completa) → voltar do navegador para A → clique em "Voltar": `back()` voltaria ao gerador. Por isso o `listReturn` é removido ao sair do detalhe para o gerador (o clique em "Gerar CV" limpa a entrada) e o link cai na última busca.
- Por que não `document.referrer`: ele não muda em navegações client-side.

### D-06. Aviso de perfil não salvo (RF-26)

- `ProfileEditor` ganha um `dirty` (`useState(false)`): `patch` liga e um save bem-sucedido desliga. O "Salvar perfil" já devolve um booleano.
- Novo hook `useUnsavedChangesGuard(dirty: boolean, message: string)` em `lib/client/use-unsaved-changes-guard.ts`:
  - `beforeunload`: `preventDefault()` e `returnValue = ""` (o navegador mostra o texto padrão dele). Cobre fechar a aba, recarregar, `HardLink` (navegação completa) e o "voltar" do navegador para outro documento;
  - listener de `click` em **captura** no `document`: se o alvo é um `<a>` com `href` de mesma origem, sem `target="_blank"`, sem `download`, sem modificador e com caminho diferente do atual, chama `window.confirm(message)`. Se a pessoa cancelar, faz `preventDefault()` e `stopPropagation()`. A captura no `document` roda antes do handler do `next/link` (o React escuta no root), então a navegação client-side também é barrada.
- Mensagem: "Você tem alterações não salvas no perfil. Sair mesmo assim?"
- `window.confirm` em vez do `Dialog` do projeto: o diálogo assíncrono exigiria reexecutar a navegação depois da resposta (guardar `href`, distinguir `HardLink` de `next/link`). O nativo é síncrono, acessível e consistente com o `beforeunload`, que também é nativo.
- Fora do escopo: o "voltar" do navegador entre duas rotas client-side. Não se aplica, porque `/perfil` é rota `(local)`, carregada como documento próprio, e esse caso cai no `beforeunload`.

### Eixos sem impacto

Dados no servidor e migrações, APIs e contratos, performance de backend, filas e jobs, observabilidade (sem eventos customizados, conforme o PRD), CSP (nenhum host novo em `connect-src`).

## 4. Segurança e privacidade

- A última busca pode conter o texto digitado (`q`). Ela fica só no localStorage, como a busca padrão já faz, e o analytics continua cortando a query (`lib/shared/analytics.ts`). A página `/privacidade` passa a citar "a última busca que você fez" entre os dados guardados no navegador.
- O link do Glassdoor tem host fixo, nome na query codificada e `rel="noopener noreferrer nofollow"`. Nenhuma requisição sai do app.
- A store valida o conteúdo com Zod na leitura. Lixo no localStorage vira `null`, como nas demais stores.

## 5. Testes (rastreados aos critérios do PRD)

| Teste | Tipo | Cobre |
|---|---|---|
| `tests/unit/client/jobs/glassdoor.test.ts`: domínio por origem, acentos e `&`, sufixos (tabela), genéricos → `null`, origem da URL fixa | unit | RF-01, RF-04, RN-11, RN-12 |
| `tests/unit/client/jobs/restore-filters.test.ts`: precedência URL > last (≤ 7 d) > saved > nada; last expirada; last vazia | unit (hook com Testing Library) | RF-13, RN-15 |
| `remember-filters`: grava ao mudar, não grava antes de `ready`, "Limpar tudo" grava `null`, `ocultas` nunca entra | unit | RF-10, RN-16 |
| `list-href.test.ts`: href igual ao que o nuqs gera para os mesmos filtros; `/` sem store | unit | RF-11 |
| `back-to-jobs-link.test.tsx`: `back()` só com `listReturn` igual e `history.length > 1` | unit | RF-12 |
| `unsaved-changes-guard.test.tsx`: confirm em link interno, ignora `_blank`, modificadores e mesmo caminho; `beforeunload` só quando `dirty` | unit | RF-26 |
| `job-card-menu`: item Glassdoor presente ou ausente | unit | RF-03 |
| E2E `tests/e2e/filters-persistence.spec.ts`: as 6 rotas da US-02 (voltar desktop, voltar celular, header "Vagas", logo, aba do celular, reabrir a home em contexto novo com o localStorage preenchido) + aviso RF-14 + URL compartilhada vence | e2e | US-02 |
| E2E em `profile.spec.ts`: editar, clicar em "Vagas", cancelar o confirm, continuar no perfil; aceitar e sair | e2e | US-06 |
| E2E em `job-detail.spec.ts`: link do Glassdoor com href esperado | e2e | US-01 |

Verificação final: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`.

## 6. Plano de entrega (fase única, 3 blocos independentes)

| # | Tarefa | Arquivos | Esforço | Depende de |
|---|---|---|---|---|
| A1 | `glassdoor.ts` + testes | `lib/client/jobs/glassdoor.ts` | P | — |
| A2 | Link no detalhe e item no menu ⋯ | `JobDetail.tsx`, `JobCardMenu.tsx`, `JobCard.tsx` | P | A1 |
| B1 | Store `lastFilters`, `useRememberFilters`, `useRestoreFilters` + testes | `saved-search.ts`, `storage/keys.ts`, `JobsPage.tsx` | M | — |
| B2 | Aviso "Busca da última visita restaurada" | `JobsPage.tsx` | P | B1 |
| B3 | `serializeFilters`, `useJobsListHref`, `JobsListLink` + troca nos 4 pontos | `use-jobs.ts`, `list-href.ts`, `JobsListLink.tsx`, `SiteHeader.tsx`, `MobileTabBar.tsx`, `JobDetail.tsx` | M | B1 |
| B4 | `markListReturn` + `BackToJobsLink` (desktop e celular) | `list-href.ts`, `JobCard.tsx`, `JobDetail.tsx` | M | B3 |
| B5 | E2E de persistência + texto em `/privacidade` | `tests/e2e/filters-persistence.spec.ts`, `app/(site)/privacidade/page.tsx` | M | B1–B4 |
| C1 | `useUnsavedChangesGuard` + `dirty` no editor + testes e E2E | `lib/client/use-unsaved-changes-guard.ts`, `ProfileEditor.tsx`, `profile.spec.ts` | P | — |

Os blocos A, B e C são independentes entre si (arquivos diferentes, exceto `JobDetail.tsx`, que A2 e B3/B4 tocam em trechos distintos e devem ser feitos em sequência). Caminho crítico: B1 → B3 → B4 → B5.

## 7. Riscos

| Risco | Prob. / Impacto | Mitigação |
|---|---|---|
| URL de busca do Glassdoor não funciona para humanos | Média / Baixo | P-01; fallback Google numa função |
| O efeito de gravação sobrescreve a última busca antes da restauração | Média / Alto | Gate em `ready` + teste específico |
| `router.back()` leva para fora do app | Baixa / Médio | Exige `listReturn` com o mesmo `jobId` e `history.length > 1` |
| Listener de clique em captura conflita com outros handlers | Baixa / Baixo | Só age com `dirty`; ignora `_blank`, modificadores e mesmo caminho |
| Pessoa estranha a busca restaurada | Média / Médio | Aviso com "Limpar"; validade de 7 dias |

## 8. Premissas e perguntas em aberto

| # | Item | Status |
|---|---|---|
| P-01 | A busca do Glassdoor (`/Search/results.htm?keyword=`) funciona em navegador comum | Confirmado pelo mantenedor em 2026-11-25 (.com.br) |
| P-02 | A última busca guarda também o texto (`q`) (Q-02 do PRD) | Adotado |
| P-03 | Validade de 7 dias (Q-03 do PRD) | Adotado |
| P-04 | Remover filtros um a um até zerar equivale a "Limpar tudo" | Adotado |
