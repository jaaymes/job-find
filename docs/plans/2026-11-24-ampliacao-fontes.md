# Ampliação das fontes de vagas — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** levar o índice de 847 para mais de 3.000 vagas ativas, com mais vagas nacionais, só com fontes que permitem coleta. O LinkedIn entra como link de busca.

**Arquitetura:** os conectores multi-board passam a rodiziar boards entre execuções, com prazo por fonte e expiração limitada aos boards lidos. Fontes novas entram como conectores isolados no padrão atual (`lib/server/sources/<fonte>.ts`, registrados em `registry.ts`). As listas curadas crescem por um script offline de descoberta com revisão humana.

**Stack:** Next.js 16 / TypeScript, Drizzle + Postgres (Neon), zod, vitest, Playwright.

**Spec:** [docs/tech/2026-11-24-ampliacao-fontes.md](../tech/2026-11-24-ampliacao-fontes.md). Leia também [docs/fontes.md](../fontes.md).

## Restrições globais

- Fetch só para hosts fixos em `allowedHosts`, via `createSafeFetch` (`lib/server/sources/http.ts`). Nunca subdomínio dinâmico nem curinga.
- Coleta inteira ≤ 240 s (`DEFAULT_BUDGET_MS`, `lib/server/collect/run.ts:14`). Teto por fonte: **90 s** (`SOURCE_SOFT_LIMIT_MS = 90_000`).
- Toda fonte nova ganha uma linha em `docs/fontes.md` com link e data da checagem dos termos (RN-09) antes de ir para produção.
- Nenhum conector registra chave ou token em log.
- O LinkedIn só aparece como link; nenhuma requisição ao LinkedIn sai do app ou do servidor.
- Variáveis de ambiente novas: nenhuma. (A Adzuna e suas variáveis foram canceladas em 2026-11-24: serviço pago.) Serviço externo só entra se for gratuito.
- Textos de interface e de documentação em pt-BR; identificadores em inglês.
- **Sem commit, branch ou push sem pedido explícito do usuário.** O passo "Commit" de cada tarefa vira "deixar pronto para commit".
- Verificação de cada tarefa: `pnpm typecheck && pnpm lint && pnpm test`. Tarefas do runner também rodam `pnpm test:integration`. Tarefas de conector rodam `pnpm test:contract -- <fonte>` quando há rede.

## Foco de revisão

1. **Slug com `_` ou `%` no `LIKE` da expiração por board.** Em `LIKE`, `_` casa qualquer caractere, então `wildlife_studios:` não pode expirar vagas de `wildlifeXstudios`. O teste fica na Tarefa 2.
2. **Cursor de rodízio inválido ou fora do tamanho da lista** (lista encolheu num deploy, cursor antigo de outra fonte, texto não numérico). O esperado é recomeçar do índice 0, sem erro. O teste fica na Tarefa 2.
3. **Board que responde com lista vazia.** Ele não pode entrar no escopo de expiração, para não expirar as vagas dele. O teste fica na Tarefa 2.
4. **Prazo já vencido ao começar a fonte.** O pool processa pelo menos 1 board, nunca lança "todos os boards falharam" com zero tentativas e avança o cursor. O teste fica na Tarefa 2.
5. **Filtro com acento, `&`, `#` ou vazio no link do LinkedIn.** A URL precisa sair válida, com `keywords` codificado; sem filtro, usa `keywords=desenvolvedor`. O teste fica na Tarefa 6.

---

## Fase 1: volume sem chave

Ordem e paralelismo:
- A Tarefa 1 vai primeiro, porque concentra as listas de `SourceId` e evita conflito entre as outras.
- Depois dela, rodam em paralelo: Tarefa 2 (runner e pool), Tarefa 3 (GitHub), Tarefa 4 (4dayweek), Tarefa 5 (Get on Board) e Tarefa 6 (LinkedIn).
- A Tarefa 7 depende da Tarefa 2. A Tarefa 8 é o portão.

### Task 1: Registrar os novos `SourceId`

**Arquivos:**
- Modificar: `lib/shared/types/job.ts` (união `SourceId`), `lib/shared/schemas/jobs-query.ts` (`SOURCE_IDS`), `lib/client/jobs/use-jobs.ts:~54` (lista de origens), `components/jobs/format.ts` (rótulos)
- Testar: `tests/unit/components/jobs.test.tsx` (ou o teste existente dos rótulos de `format.ts`)

**Interfaces:**
- Produz os `SourceId` `"fourdayweek"`, `"getonboard"` e `"adzuna"`, com os rótulos `"4 Day Week"`, `"Get on Board"` e `"Adzuna"`.

- [ ] **Passo 1: Teste que falha.** `jobsQuerySchema.parse({ source: ["fourdayweek", "getonboard", "adzuna"] })` não lança. O rótulo de cada id em `format.ts` é o texto acima.
- [ ] **Passo 2:** rodar `pnpm test` e conferir que FALHA (enum inválido).
- [ ] **Passo 3:** acrescentar os 3 ids nas 4 listas, na mesma ordem. Nenhum conector ainda: `CONNECTORS` é `Partial`, então nada quebra.
- [ ] **Passo 4:** rodar `pnpm typecheck && pnpm test` e conferir que PASSA.
- [ ] **Passo 5:** deixar pronto para commit (`feat(fontes): registra ids fourdayweek, getonboard e adzuna`).

### Task 2: Rodízio de boards, prazo por fonte e expiração por board (D-01)

**Arquivos:**
- Modificar: `lib/server/sources/types.ts` (`ConnectorContext`), `lib/server/sources/boards.ts`, `lib/server/collect/run.ts` (`runSource`, ctx em ~:237), `lib/server/jobs/expire.ts:24`, `tests/unit/server/sources/helpers.ts` (`fakeCtx`)
- Testar: `tests/unit/server/sources/boards.test.ts`, `tests/integration/collect/run.test.ts`

**Interfaces:**
- `ConnectorContext` ganha:
  - `deadlineAt: number` (epoch ms);
  - `reportScope(prefixes: readonly string[]): void`.
- `fetchBoardsPooled(ctx, label, boards, fetchBoard, opts?: { scopePrefix?: (board: string) => string })`:
  - o padrão de `scopePrefix` é ``(b) => `${b}:` ``;
  - o GitHub passa ``(repo) => `${repo}#` ``;
  - a concorrência passa de 3 para **5**.
- `markMissedRuns(db, source, runStartedAt, fetchedCount, previousCount, scopePrefixes?: readonly string[])`.
- Cursor do rodízio: string com o índice decimal do próximo board (`"0"`, `"37"`).

- [ ] **Passo 1: Testes que falham** em `boards.test.ts`. O `fakeCtx` ganha `deadlineAt` (padrão `Date.now() + 60_000`) e grava `scopes: string[][]`.
  - `"começa no board do cursor e dá a volta"`: com 7 boards, `cursor: "5"` e prazo folgado, a ordem de chamada é `f, g, a, b, c, d, e`, e `ctx.cursors` termina com `"5"` (volta completa).
  - `"para de agendar perto do prazo e grava onde parou"`: com `deadlineAt = Date.now() + 4_000` e cada board levando 0 ms, só 1 board é chamado (margem de 5 s) e o cursor vira o índice seguinte.
  - `"cursor inválido recomeça do zero"`: para `"abc"`, `"-1"` e `"99"`, o primeiro board chamado é `"a"`.
  - `"board com lista vazia ou com falha fica fora do escopo"`: `a` devolve `[1]`, `b` devolve `[]` e `c` lança; `scopes.flat()` é `["a:"]`.
  - `"prazo vencido ainda tenta 1 board e não lança 'todos falharam'"`: com `deadlineAt = Date.now() - 1`, 1 chamada, sem rejeição, e o cursor avança 1.
- [ ] **Passo 2:** rodar `pnpm vitest run tests/unit/server/sources/boards.test.ts` e conferir que FALHA.
- [ ] **Passo 3: Implementar em `boards.ts`.**
  - O índice inicial é `Number.parseInt(cursor)` se for inteiro em `[0, n)`; senão, 0.
  - Os workers pegam boards em ordem circular enquanto `processed < n` e (`attempted === 0` ou `Date.now() < ctx.deadlineAt - 5_000`).
  - No fim: `ctx.setCursor(String((start + attempted) % n))` e `ctx.reportScope(boards com ≥ 1 vaga e sem erro, mapeados por scopePrefix)`.
  - "Todos falharam" passa a ser `failures === attempted && attempted > 0`.
- [ ] **Passo 4:** rodar o teste unitário e conferir que PASSA. Rodar os testes de cada conector multi-board (greenhouse, ashby, lever, github) e conferir que continuam passando.
- [ ] **Passo 5: Testes de integração que falham** em `run.test.ts`, seguindo o padrão dos testes de `markMissedRuns` (~:185):
  - `"fonte com escopo marca coleta perdida só nos boards lidos"`: um conector fake `fullSnapshot` com vagas `a:1`, `b:1` já no banco. Nesta execução, ele lê só `a` (sem `a:1`, com `a:2`) e chama `reportScope(["a:"])`. Resultado: `a:1` tem `missed_runs = 1` e `b:1` continua 0.
  - `"prefixo com _ não casa outro board"`: as vagas `wild_x:1` e `wildAx:1` existem, o escopo é `["wild_x:"]` e só `wild_x:1` é marcada.
  - `"ctx.deadlineAt é no máximo 90 s depois do início da fonte e nunca passa do budget"`.
- [ ] **Passo 6: Implementar o runner e a expiração.**
  - **No runner:** `deadlineAt = Math.min(budgetEndsAt - tailMs, Date.now() + SOURCE_SOFT_LIMIT_MS)`. `reportScope` acumula prefixos.
  - **Regra da expiração:** se houve escopo, chamar `markMissedRuns(..., previousCount = null, scopePrefixes)` mesmo com falhas parciais, já que os boards com falha não estão no escopo. Se não houve, manter a regra atual (`fullSnapshot && partialBoards.length === 0`).
  - **Em `expire.ts`:** com `scopePrefixes`, acrescentar `external_id LIKE ANY(<padrões>) ESCAPE '\'`, escapando `\`, `%` e `_` de cada prefixo e acrescentando `%`.
  - **`missed_runs`:** o `sourceState.lastFetchedCount` continua sendo gravado, mas não serve de guarda quando há escopo.
- [ ] **Passo 7:** rodar `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration` e conferir que PASSA.
- [ ] **Passo 8: Documentação.** Atualizar as "Regras comuns" de `docs/fontes.md`: rodízio, teto de 90 s por fonte, expiração por board e concorrência 5. Deixar pronto para commit (`feat(coleta): rodízio de boards com prazo por fonte e expiração por board`).

### Task 3: Mais repositórios do GitHub (D-04)

**Arquivos:** modificar `lib/server/sources/github.ts:14` (`GITHUB_REPOS`), `docs/fontes.md` (boards curados); testar `tests/unit/server/sources/github.test.ts`.

- [ ] **Passo 1: Teste que falha.** `GITHUB_REPOS` contém `"soujava/vagas-java"`, `"DevOps-Brasil/Vagas"`, `"phpdevbr/vagas"`, `"CocoaHeadsBrasil/vagas"`, `"dotnetdevbr/vagas"`, `"vuejs-br/vagas"` e `"flutterbr/vagas"`, e tem 12 itens.
- [ ] **Passo 2:** rodar o teste e conferir que FALHA.
- [ ] **Passo 3:** acrescentar os 7 repositórios no fim da lista.
- [ ] **Passo 4:** rodar o teste e conferir que PASSA. Se houver rede, rodar `pnpm test:contract -- github`.
- [ ] **Passo 5:** atualizar a lista do GitHub em `docs/fontes.md`. Deixar pronto para commit.

### Task 4: Conector 4dayweek (D-02)

**Arquivos:**
- Criar: `lib/server/sources/fourdayweek.ts`, `tests/fixtures/sources/fourdayweek/{brazil-page-1,remote-page-1,remote-page-2}.json`, `tests/unit/server/sources/fourdayweek.test.ts`
- Modificar: `lib/server/sources/registry.ts`, `tests/contract/sources.contract.test.ts`, `docs/fontes.md`

**Interfaces:**
- Exporta `fourdayweek: Connector`, `FOURDAYWEEK_HOST = "4dayweek.io"`.
- Configuração do conector: `id: "fourdayweek"`, `brazilian: false`, `fullSnapshot: false`, `minIntervalMinutes: 60`, `attribution: { label: "4 Day Week", url: "https://4dayweek.io", dofollow: false }`.
- Cursor: JSON `{"remotePage": number}`.

- [ ] **Passo 1: Spike S-1** (sem código):
  - **Fixtures:** com `curl`, gravar uma página de `https://4dayweek.io/api/v2/jobs?limit=100&country=Brazil&category=engineering,data,security,product,design` e duas de `…&work_arrangement=remote&category=engineering,data,security`. Cortar cada fixture para 5 vagas, mantendo `has_more`.
  - **Campos:** anotar no topo do teste os nomes reais de id, URL da página da vaga, empresa e logo, `locations[]`, `skills`, salário (centavos de USD), datas e o parâmetro de paginação.
  - **Ordenação:** verificar se a lista vem ordenada por publicação, da mais nova para a mais antiga. **Se não vier, parar e avisar** (a spec prevê trocar o modo).
  - **Termos:** ler `https://4dayweek.io/developers` e registrar o que diz e a data.
- [ ] **Passo 2: Testes que falham** (usando `fakeCtx` e `collect`):
  - `"busca primeiro a consulta Brasil inteira, depois a remota a partir do cursor"`: as URLs pedidas, em ordem, e o host é sempre `4dayweek.io`.
  - `"no máximo 12 páginas por execução"`: as páginas Brasil contam no teto.
  - `"remota sem has_more volta o cursor para a página 1"`: `ctx.cursors` termina com `{"remotePage":1}`.
  - `"normalize"`:
    - `url` é a página da vaga no 4dayweek;
    - salário em centavos vira unidades em `USD`, período `"year"`;
    - `locations` com Brasil vira `country: "BR"`;
    - remota vira `workModeHint: "remote"` e `eligibleRegions` a partir dos países ou regiões;
    - `skills` vira `tags`;
    - vaga sem título devolve `null`.
- [ ] **Passo 3:** rodar o teste e conferir que FALHA.
- [ ] **Passo 4: Implementar** `fetch` e `normalize` no padrão de `himalayas.ts`, que também é incremental e paginado. Registrar em `registry.ts` e no teste de contrato.
- [ ] **Passo 5:** rodar `pnpm typecheck && pnpm lint && pnpm test` e conferir que PASSA. Com rede, rodar também `pnpm test:contract -- fourdayweek`.
- [ ] **Passo 6:** acrescentar a linha em `docs/fontes.md` (endpoint, termos com link e data, atribuição, incremental, teto de 12 páginas, aviso de duplicação com ATS). Deixar pronto para commit.

### Task 5: Conector Get on Board (D-02)

**Arquivos:**
- Criar: `lib/server/sources/getonboard.ts`, `tests/fixtures/sources/getonboard/{programming-1,programming-2,cybersecurity-1}.json`, `tests/unit/server/sources/getonboard.test.ts`
- Modificar: `registry.ts`, `tests/contract/sources.contract.test.ts`, `docs/fontes.md`

**Interfaces:**
- Exporta `getonboard: Connector`, `GETONBOARD_HOST = "www.getonbrd.com"` e `GETONBOARD_CATEGORIES`, com os valores `programming`, `sysadmin-devops-qa`, `data-science-analytics`, `machine-learning-ai`, `design-ux`, `cybersecurity` e `mobile-developer`.
- Configuração do conector: `id: "getonboard"`, `brazilian: false`, `fullSnapshot: true`, `minIntervalMinutes: 60`, `attribution: { label: "Get on Board", url: "https://www.getonbrd.com", dofollow: false }`.
- Usa `fetchBoardsPooled` com as categorias como "boards". `externalId` = `${categoria}:${id}`.

- [ ] **Passo 1: Fixtures e termos.**
  - Gravar com `curl` fixtures reais de `https://www.getonbrd.com/api/v0/categories/<cat>/jobs?per_page=100&page=N`, cortadas e incluindo pelo menos uma vaga presencial no Chile, uma remota e uma no Brasil.
  - Anotar os campos reais: `remote_modality`, `countries`, `public_url`, `min_salary`/`max_salary` e `published_at` em epoch.
  - Registrar os termos com a data ([ajuda da API](https://www.getonbrd.com/help/how-can-i-use-get-on-board-public-api-to-show-jobs-on-my-site)).
- [ ] **Passo 2: Testes que falham.**
  - `"pagina cada categoria até a página vir com menos de 100 itens"`.
  - `"normalize descarta presencial ou híbrida fora do Brasil"`: devolve `null`.
  - `"normalize mantém remota e vagas no Brasil"`:
    - `url` = `public_url`;
    - `publishedAt` vem do epoch;
    - salário vem quando informado (moeda e período conforme a fixture);
    - `country: "BR"` para vagas no Brasil.
- [ ] **Passo 3:** rodar o teste e conferir que FALHA.
- [ ] **Passo 4:** implementar no padrão de `greenhouse.ts` e registrar.
- [ ] **Passo 5:** rodar `pnpm typecheck && pnpm lint && pnpm test` e conferir que PASSA. Com rede, rodar também `pnpm test:contract -- getonboard`.
- [ ] **Passo 6: Documentação.** Acrescentar a linha em `docs/fontes.md`, deixando explícitos três pontos: o crédito "Get on Board", a remoção da vaga em até 24 h (as 3 coletas perdidas com cron horário cumprem isso) e a proibição de repassar os dados. Deixar pronto para commit.

### Task 6: Link "Buscar também no LinkedIn" (D-06)

**Arquivos:**
- Criar: `lib/client/jobs/linkedin-search.ts`, `components/jobs/LinkedInSearchLink.tsx`, `tests/unit/client/jobs/linkedin-search.test.ts`
- Modificar: `components/jobs/JobsPage.tsx` (perto do `<SearchBar>` em ~:126 e no estado vazio), `tests/unit/components/jobs.test.tsx`

**Interfaces:**
- `buildLinkedInSearchUrl(f: { q?: string; stacks?: string[]; workMode?: "remote" | "hybrid" | "onsite"; seniority?: Array<"intern" | "junior" | "mid" | "senior" | "lead">; since?: "24h" | "7d" | "30d" }): string`.
- O componente recebe os `filters` que `useJobsFilters()` já devolve.

- [ ] **Passo 1: Testes que falham** em `linkedin-search.test.ts`, conferindo com `new URL(...)`:
  - **Base:** `origin + pathname === "https://www.linkedin.com/jobs/search/"` e `geoId=106057199`.
  - **`keywords`:** `{ q: "São Paulo & C#", stacks: ["react", "node"] }` resulta em `keywords === "São Paulo & C# react node"`, lido por `searchParams.get`, o que prova a codificação.
  - **Sem filtro:** `{}` resulta em `keywords=desenvolvedor` e `f_TPR=r604800`.
  - **Período:** `since` `24h`, `7d` e `30d` viram `f_TPR` `r86400`, `r604800` e `r2592000`.
  - **Modo de trabalho:** `workMode` `remote`, `hybrid` e `onsite` viram `f_WT` `2`, `3` e `1`; sem `workMode`, não há `f_WT`.
  - **Senioridade:** `seniority: ["junior", "senior"]` vira `f_E === "2,4"`. O mapa é intern=1, junior=2, mid=3, senior=4, lead=5.
- [ ] **Passo 2:** rodar `pnpm vitest run tests/unit/client/jobs/linkedin-search.test.ts` e conferir que FALHA.
- [ ] **Passo 3:** implementar a função pura com `URLSearchParams`.
- [ ] **Passo 4: Teste de componente que falha.** O link com texto "Buscar também no LinkedIn" tem `target="_blank"`, `rel="noopener noreferrer"` e `href` igual a `buildLinkedInSearchUrl(filtros)`. Aparece na lista com resultados e no estado vazio.
- [ ] **Passo 5:** implementar `LinkedInSearchLink`, só texto e sem logo, com o estilo de link secundário já usado na `JobsPage`, e inserir nos dois pontos.
- [ ] **Passo 6:** rodar `pnpm typecheck && pnpm lint && pnpm test` e conferir que PASSA. Confirmar que `lib/shared/csp.ts` não mudou. Deixar pronto para commit.

### Task 7: Descoberta de boards e listas maiores (D-03)

**Depende de:** Tarefa 2 (as listas grandes só vão para produção com o rodízio).

**Arquivos:**
- Criar:
  - `scripts/discover-boards.ts` (CLI);
  - `scripts/discover-boards/validate.ts` (regra pura);
  - `lib/server/sources/boards/{greenhouse,ashby,lever}.ts`, que exportam `GREENHOUSE_BOARDS`, `ASHBY_BOARDS` e `LEVER_BOARDS`;
  - `tests/unit/scripts/discover-validate.test.ts`.
- Modificar:
  - `greenhouse.ts`, `ashby.ts` e `lever.ts`: importam e reexportam a lista;
  - `.gitignore`: acrescentar `scripts/discover-boards/out/`;
  - `docs/fontes.md`;
  - `vitest.config.ts`, se o projeto `unit` não incluir `tests/unit/scripts`.

**Interfaces:**
- `acceptBoard(input: { slug: string; boardName: string | null; total: number; normalized: Array<NormalizedJob | null> }): { accept: boolean; tech: number; br: number; reason: string | null }`.
  - `normalized` é o resultado do `normalize` do próprio conector sobre cada vaga crua, para reaproveitar o filtro tech RN-01 e o parser de local.

- [ ] **Passo 1: Testes que falham** de `acceptBoard`:
  - `total: 0` resulta em `accept: false, reason: "sem vagas"`.
  - `boardName: "ARCO Companies"` com `slug: "arco"` passa no nome, mas com 0 vagas tech e 0 BR resulta em `accept: false`.
  - 10 vagas, 3 tech e nenhuma BR resulta em `accept: true` (30% tech).
  - 10 vagas, 1 tech e 1 com `country: "BR"` resulta em `accept: true`.
  - `boardName: "Nuvem Health"` com `slug: "nuvem"` e 0 vagas BR resulta em `accept: false` quando `tech / total < 0.3`.
  - `br` conta `country === "BR"` ou `eligibleRegions` contendo Brasil, LatAm ou mundo (usar os mesmos valores que `classifyOrigin` reconhece em `lib/server/enrich/origin.ts`).
- [ ] **Passo 2:** rodar o teste e conferir que FALHA.
- [ ] **Passo 3:** implementar `acceptBoard`.
- [ ] **Passo 4:** rodar o teste e conferir que PASSA.
- [ ] **Passo 5: Implementar `scripts/discover-boards.ts`** (`pnpm tsx scripts/discover-boards.ts --ats greenhouse|ashby|lever`).
  - **Origem dos slugs:**
    - `https://raw.githubusercontent.com/ConorsCode/open-jobs-data/main/…` (ver a estrutura do repositório no passo);
    - `https://yc-oss.github.io/api/companies/hiring.json`, de onde sai o slug do nome e do site;
    - Common Crawl: `https://index.commoncrawl.org/CC-MAIN-2026-47-index?url=job-boards.greenhouse.io/*&output=json`, e `jobs.ashbyhq.com/*` para o Ashby. Com retentativa em 504.
  - **Teste de cada slug:** pelo `createSafeFetch` do conector, com no máximo 4 simultâneos, pulando os slugs já curados.
  - **Saída:** `scripts/discover-boards/out/candidates-<ats>.json`, ordenado por `br` decrescente e depois `tech`.
  - **Segurança:** não grava nada em `lib/`.
- [ ] **Passo 6: Rodar e revisar.**
  - Rodar o script para os 3 ATS e revisar os candidatos com o usuário. **Parar e mostrar o resumo antes de editar as listas.**
  - Montar as listas aprovadas nos arquivos `lib/server/sources/boards/*.ts`, com os boards de mais vagas BR primeiro e os curados atuais mantidos. A meta é cerca de 150 / 80 / 20.
- [ ] **Passo 7:** rodar `pnpm typecheck && pnpm lint && pnpm test` e conferir que PASSA. Com rede, rodar `pnpm test:contract -- greenhouse ashby lever`.
- [ ] **Passo 8:** atualizar a seção "Boards curados" de `docs/fontes.md`, com contagem e origem da descoberta, e a seção de operação (como rodar o script). Deixar pronto para commit.

### Task 8: Portão da Fase 1

- [ ] **Passo 1:** rodar `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration`. Esperado: tudo verde.
- [ ] **Passo 2:** subir o ambiente local (`docker compose up -d --build app cron`) e disparar a coleta com `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:<porta>/api/cron/collect`. Repetir de hora em hora pelo cron por 24 h.
- [ ] **Passo 3: Medir no Postgres.**
  - Ativas por fonte e por origem, com a mesma consulta da seção 1 da spec.
  - Duração máxima por execução em `source_runs`: ≤ 240 s no total e ≤ 90 s por fonte, da busca ao fim da gravação. Atenção: `started_at` é o início da coleta (o mesmo `now` para todas as fontes da execução), então `finished_at − started_at` só é a duração da fonte para as 5 primeiras da fila, que começam juntas; para as demais, é um teto (inclui a espera na fila). O runner garante isso dando ao conector um prazo de busca de `min(início + 60 s, fim do budget − 35 s)`, com 30 s de reserva para a requisição em andamento (timeout de 20 s) e a gravação; fonte que começa sem essa margem fica `skipped` sem linha em `source_runs`. Conferir também nos logs quantas fontes foram puladas por "sem margem para buscar e gravar".
  - Erros em `source_runs`.
  - Taxa de duplicação do 4dayweek: vagas do `fourdayweek` cuja `jobs.sources` tem mais de uma fonte.
- [ ] **Passo 4:** medir o p95 de `/api/jobs` com `autocannon` (≤ 500 ms, como na spec base).
- [ ] **Passo 5: Critério.** ≥ 3.000 ativas, nenhuma execução acima do budget e termos de cada fonte nova registrados em `docs/fontes.md`. Relatar o resultado real ao usuário antes da Fase 2.

---

## Fase 2: vagas nacionais

As Tarefas 9 e 10 são independentes e podem rodar em paralelo.

### Task 9: Conector SmartRecruiters (D-05)

**Arquivos:**
- Criar: `lib/server/sources/smartrecruiters.ts`, `lib/server/sources/boards/smartrecruiters.ts`, fixtures `tests/fixtures/sources/smartrecruiters/{experian-list,experian-detail}.json`, `tests/unit/server/sources/smartrecruiters.test.ts`
- Modificar: `registry.ts`, contrato, `docs/fontes.md`

**Interfaces:**
- `SMARTRECRUITERS_HOST = "api.smartrecruiters.com"` e `SMARTRECRUITERS_BOARDS`, começando por `"Experian"` e `"BoschGroup"` (os ids diferenciam maiúsculas e minúsculas) mais o que o script da Tarefa 7, estendido com `--ats smartrecruiters`, aprovar.
- Configuração do conector: `id: "smartrecruiters"`, `brazilian: false`, `fullSnapshot: true`, `minIntervalMinutes: 60`, `attribution: { label: "SmartRecruiters", url: "https://www.smartrecruiters.com", dofollow: false }`.
- `externalId` = `${companyId}:${postingId}`.

- [ ] **Passo 1:** gravar fixtures de `/v1/companies/Experian/postings?limit=100&offset=0&country=br` e de um `/postings/<id>`. Ler os termos em developers.smartrecruiters.com e registrar com a data.
- [ ] **Passo 2: Testes que falham.**
  - Pagina por `offset` até `totalFound`.
  - `totalFound: 0` conta como falha do board (id inválido), via `reportPartial`.
  - Só itens com `function.id === "information_technology"` buscam o detalhe.
  - `normalize` usa a descrição do detalhe e o local com remoto ou híbrido.
- [ ] **Passo 3:** rodar o teste e conferir que FALHA.
- [ ] **Passo 4:** implementar com `fetchBoardsPooled` (rodízio da Tarefa 2) e registrar.
- [ ] **Passo 5:** rodar a verificação padrão e conferir que PASSA.
- [ ] **Passo 6:** atualizar `docs/fontes.md` e deixar pronto para commit.

### Task 10: Conector Adzuna (D-05) — CANCELADA

> Cancelada em 2026-11-24: a Adzuna é paga para uso comercial. O id `adzuna` saiu de `SourceId`. Não implementar.

**Arquivos:**
- Criar: `lib/server/sources/adzuna.ts`, fixtures `tests/fixtures/sources/adzuna/{page-1,page-2}.json`, `tests/unit/server/sources/adzuna.test.ts`
- Modificar: `registry.ts`, `.env.example`, contrato, `docs/fontes.md` (variáveis aprovadas: de 4 para 6)

**Interfaces:**
- `ADZUNA_HOST = "api.adzuna.com"`.
- `createAdzuna(env: { appId?: string; appKey?: string }): Connector | null`, que devolve `null` sem as duas variáveis.
- `registry.ts` inclui `adzuna` só quando o retorno não for `null`.
- Configuração do conector: `id: "adzuna"`, `brazilian: true`, `fullSnapshot: false`, `minIntervalMinutes: 60`, `attribution` conforme o spike.

- [ ] **Passo 1: Spike S-2.**
  - Com a chave do usuário, pedida no chat e nunca gravada no repositório, gravar fixtures de `/v1/api/jobs/br/search/1?category=it-jobs&results_per_page=50&max_days_old=3&sort_by=date` e anonimizar os ids da chave na URL.
  - Ler os termos e a regra de atribuição da Adzuna.
  - Medir o total tech BR.
  - Verificar se `redirect_url` é link de rastreamento. Se for, usar como está.
  - **Se os termos proibirem republicar, parar e avisar.**
- [ ] **Passo 2: Testes que falham.**
  - `createAdzuna({})` e `createAdzuna({ appId: "x" })` devolvem `null`.
  - A URL contém `app_id`, `app_key`, `category=it-jobs` e `sort_by=date`.
  - No máximo 10 páginas.
  - O cursor guarda o `created` mais recente e a coleta para ao alcançá-lo.
  - Nenhum `console.*` recebe a chave (espiar `console.warn` e `console.error` com um erro 401 simulado).
  - `normalize` mapeia `salary_min`/`salary_max` em BRL por ano (confirmar o período na fixture) e `location.area` em `country: "BR"` e `city`.
- [ ] **Passo 3:** rodar o teste e conferir que FALHA.
- [ ] **Passo 4:** implementar e registrar de forma condicional em `registry.ts`, lendo `process.env.ADZUNA_APP_ID` e `ADZUNA_APP_KEY`.
- [ ] **Passo 5:** rodar a verificação padrão e conferir que PASSA.
- [ ] **Passo 6:** documentar as variáveis em `.env.example` e `docs/fontes.md` (inclusive no passo de provisionamento na Vercel) e deixar pronto para commit.

### Task 11: Portão da Fase 2

- [ ] Repetir os passos 1 a 4 da Tarefa 8.
- [ ] Critério: medir as nacionais rumo a ≥ 800 e relatar o número real. Se não fechar, levar ao usuário o e-mail de autorização para Remotar e Programathor, que já é pergunta em aberto da spec base.

---

## Fase 3: cauda longa e descoberta

As Tarefas 12 e 13 são independentes.

### Task 12: Fontes de cauda longa (D-07)

Fazer um conector por fonte, no padrão das Tarefas 4 e 5: fixture real, termos registrados com a data (**se proibirem coleta, a fonte não entra**), testes de `fetch` e `normalize` e linha em `docs/fontes.md`.
- `workingnomads`: `https://www.workingnomads.com/api/exposed_jobs/`, snapshot completo.
- `nodesk` e `jobspresso`: RSS, reaproveitando o parser de `<item>` de `wwr.ts` (extrair para `lib/server/sources/rss.ts` se o parser ainda não for compartilhado), modo incremental.
- `arbeitnow`: `https://www.arbeitnow.com/api/job-board-api`, só `remote: true`, incremental, no máximo 3 páginas.
- `landingjobs`: `https://landing.jobs/api/v1/jobs`, só remotas.

Cada id novo segue a Tarefa 1 (as 4 listas e os rótulos).

### Task 13: Spike Getro (S-3)

Sem código de produção. Descobrir se os boards Getro de Kaszek, monashees e Canary têm API ou feed público e quais são os termos. Registrar o resultado em `docs/tech/spikes.md` e propor um conector ao usuário se for viável.
