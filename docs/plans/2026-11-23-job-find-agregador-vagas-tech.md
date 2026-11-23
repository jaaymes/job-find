# Job Find — Plano de Implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para implementar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`). Execute **uma fase por vez**: ao fim de cada fase, rode as verificações e só siga para a próxima com o "sim" explícito do Jaymes.

**Objetivo:** construir o Job Find, um agregador open-source de vagas de tecnologia com coleta de hora em hora, filtros e chance de ser chamado. A IA de escolha do usuário (BYOK) gera CV e carta em PDF, e todos os dados pessoais ficam no navegador.

**Arquitetura:** monólito Next.js 16 na Vercel Hobby.
- **Servidor:** guarda só o índice público de vagas, no Postgres Neon. O Vercel Schedules dispara `/api/cron/collect` a cada hora; a rota roda conectores isolados e faz upsert idempotente. O `GET /api/jobs` fica em cache na CDN.
- **Navegador:** páginas estáticas que leem a API. Perfil, score, chamadas à IA, extração de PDF/DOCX e geração de PDF rodam no cliente.

**Stack:** next 16.4, react 19.3, TypeScript strict, Tailwind v4, shadcn/ui, TanStack Query 5, nuqs 2, zod 4, drizzle-orm 0.45 + drizzle-kit 0.31, @neondatabase/serverless 1.2, ai 7 + provedores `@ai-sdk/*` + `@openrouter/ai-sdk-provider` 3.1, unpdf 2.2, mammoth 1.13, @react-pdf/renderer 4.9, franc-min 6.2, sanitize-html, DOMPurify, vitest 5.1, @playwright/test 1.65.

**Documentos de referência** (o executor lê os dois antes de começar):
- Spec técnica: `docs/tech/2026-11-23-job-find-agregador-vagas-tech.md` (decisões D-01 a D-18, DDL na seção 5.2, SEC-01 a SEC-12)
- PRD: `docs/prd/2026-11-23-job-find-agregador-vagas-tech.md` (RF, RN, US)
- Telas: https://claude.ai/artifact/RRMGiqTJomVt29Yq9EZL6Y

## Restrições globais

- Node 24 e pnpm. TypeScript `strict: true`, sem `any` explícito.
- **Variáveis de ambiente:** só as quatro aprovadas: `DATABASE_URL`, `CRON_SECRET`, `GITHUB_TOKEN` e `HIMALAYAS_API_KEY`. Criar qualquer outra exige perguntar ao Jaymes antes. **Não há feature flags:** tudo entra ativo.
- Textos da interface em pt-BR. Identificadores de código em inglês.
- **Nenhum dado pessoal passa pelo servidor:** currículo, perfil, chaves de IA, CVs, favoritos e status (RN-11).
- **Ordenação obrigatória:** `published_at DESC, id DESC` (RN-02).
- **Fronteiras de código:**
  - `lib/server/*` começa com `import 'server-only'`;
  - `lib/client/*` começa com `import 'client-only'`;
  - `lib/shared/*` é isomórfico e não usa APIs de Node.
- **Fetch das fontes:** só para URLs base fixas no código, com timeout de 20 s, resposta de até 10 MB e `redirect: 'manual'`.
- **Saída da IA:** sempre renderizada como texto, nunca como HTML ou Markdown.
- **Commits:** um por tarefa, em pt-BR, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push e PR só com pedido explícito.
- **Banco de teste:** Postgres 17 via `docker-compose.test.yml`, na URL fixa `postgres://postgres:postgres@127.0.0.1:54329/jobfind_test`. É uma constante de teste, não variável de ambiente.
- **Comandos de verificação** (scripts criados na Tarefa 1):
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test` (unitários)
  - `pnpm test:integration` (precisa de `pnpm db:test:up`)
  - `pnpm test:e2e`
  - `pnpm build`

## Foco de revisão

Casos que a spec implica, mas que nenhum requisito testa diretamente. Cada um tem um teste na tarefa dona do código.

1. **Fonte devolve lista vazia ou parcial com HTTP 200:** as vagas dessa fonte não podem expirar. O `missed_runs` só incrementa se o volume buscado for ≥ 50% do anterior. Teste na Tarefa 7.
2. **Busca com caracteres especiais** (`C#`, `node.js`, `"São Paulo"`, `'`, `&`, só espaços): nunca devolve 500. Ou volta resultado, ou volta 400 com mensagem. Teste na Tarefa 8.
3. **localStorage indisponível ou cheio** (Safari privado, cota estourada): a lista de vagas continua funcionando, e o perfil mostra "não foi possível salvar neste navegador". Teste na Tarefa 22.
4. **Datas ausentes, inválidas ou no futuro na fonte:**
   - `published_at` vira `first_seen_at` quando falta;
   - datas futuras são limitadas a `now()`;
   - uma vaga republicada não sobe na lista.
   Teste na Tarefa 7.
5. **Erro do provedor de IA no meio do stream com HTTP 200, ou JSON truncado** (`finish_reason: length`): vira `AiError` tratável, sem travar a tela nem perder o que o usuário já editou. Teste na Tarefa 24.

## Mapa de arquivos

```
app/
  (site)/page.tsx                    home (shell estático) → JobsPage client
  (site)/vagas/[id]/page.tsx         detalhe (shell) → JobDetailClient
  (site)/fontes/page.tsx, privacidade/page.tsx
  (local)/perfil/page.tsx, configuracoes/page.tsx, configuracoes/callback/page.tsx,
  (local)/gerador/[jobId]/page.tsx, minhas-vagas/page.tsx
  api/jobs/route.ts, api/jobs/[id]/route.ts, api/cron/collect/route.ts, api/sources/status/route.ts
components/ (ui/ do shadcn, jobs/, profile/, settings/, generator/, my-jobs/, layout/)
lib/shared/   url.ts, stacks.ts, types/job.ts, schemas/{jobs-query,profile,tailored,fit}.ts, jobs-url.ts
lib/server/   db/{schema,client}.ts, enrich/{origin,work-mode,seniority,language,tech,dedupe}.ts,
              sanitize.ts, jobs/{upsert,expire,query,cursor}.ts, sources/{types,http,registry}.ts,
              sources/<fonte>.ts, collect/{run,lock}.ts, cron-auth.ts
lib/client/   storage/{store,keys,backup}.ts, ai/{providers,settings,model,generate,errors,pkce}.ts,
              ai/prompts/{untrusted,profile.extract.v1,job.fit.v1,cv.tailor.v1}.ts,
              extract/{index,contact}.ts, score/score.ts, cv/{assemble,validate}.ts,
              pdf/{CvDocument,CoverLetterDocument,filename,fonts}.ts(x), jobs/{use-jobs,job-state}.ts
drizzle/0001_init.sql (+ meta/)
tests/unit/**, tests/integration/**, tests/e2e/**, tests/fixtures/{sources,cv,ai}/**
scripts/eval-ai.ts
docs/fontes.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, .env.example, .github/**
```

## Mapa de paralelismo

| Fase | Tarefas | Pode rodar em paralelo |
|---|---|---|
| 0 | 0.1–0.4 | Todos os spikes |
| 1 | 1 → 2, 3, 4, 5 [P] → 6 → 7, 8 [P] → 9 · 10 → 11–14 [P] → 15 → 16 · 17 · 18, 19 [P] (depois de 9) → 20 | 2–5; 7 e 8; 11–14; 18 e 19 |
| 2 | 21 → 22 → 23 → 24 → 25, 26 [P] · 27 [P com 23] → 28 → 29, 30 [P] | 25 e 26; 27 em paralelo com 23–24; 29 e 30 |
| 3 | 31 → 32 → 33 → 34 · 35 | 33 em paralelo com 32 |
| 4 | 36, 37, 38, 39, 40, 41 | Todas, depois da Fase 1. A 36 e a 37 também dependem da 21 |

---

## Fase 0: Spikes

Saída única: `docs/tech/spikes.md`, com uma seção por spike, cada uma com veredito **confirmado** ou **plano B escolhido** e a evidência. Não é TDD. O código dos spikes fica em `spikes/` e é apagado no fim da fase.

### Task 0.1: Vercel Schedules e CRON_SECRET
- [ ] Fazer deploy de uma rota `spikes/schedule-probe` que grava os headers recebidos num log, com um agendamento por hora no Vercel Schedules.
- [ ] **Confirmar:** o agendamento roda de hora em hora no Hobby e envia `Authorization: Bearer <CRON_SECRET>`. Registrar o formato de configuração (`vercel.json` ou painel).
- [ ] **Se não enviar o header:** plano B com GitHub Actions `schedule: '17 * * * *'` chamando a rota com `curl -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}"`.

### Task 0.2: CSP por SRI
- [ ] Criar um app mínimo com Next 16.4 e `experimental.sri: { algorithm: 'sha256' }`. Montar uma página com `unpdf` (`import()`) e outra com `@react-pdf/renderer` (`dynamic`, `ssr:false`), e aplicar a CSP da D-15 via `headers()`.
- [ ] **Confirmar:** nenhuma violação de CSP no console (Playwright, `page.on('console')`) e as páginas continuam estáticas (`○` no output do `next build`). Registrar se `'wasm-unsafe-eval'` ou `worker-src blob:` são necessários.
- [ ] **Plano B:** nonce só nas rotas `(local)`.

### Task 0.3: Provedores de IA no navegador
- [ ] Criar uma página de teste que chama `streamText` com `Output.object` para OpenRouter (`deepseek/deepseek-v4.1-flash` e `deepseek/deepseek-v4-flash`, com `provider: { require_parameters: true, data_collection: 'deny' }`), OpenAI, Anthropic (header `anthropic-dangerous-direct-browser-access`), Gemini, DeepSeek direto e Ollama local.
- [ ] **Confirmar por provedor:** CORS, JSON válido, streaming, comportamento de erro com HTTP 200 no meio do stream, json_schema da DeepSeek e Local Network Access no Chrome. Medir também a qualidade PT/EN com 5 currículos (P-02).
- [ ] Testar o PKCE do OpenRouter com `limit=5&expiration=1-year`.
- [ ] Registrar uma tabela provedor × modo de saída estruturada. Ela alimenta o campo `structured` da Tarefa 23.

### Task 0.4: Extração de PDF
- [ ] Medir o `unpdf` com um PDF de 10 páginas: tempo e bloqueio da thread principal.
- [ ] **Se travar mais de 300 ms:** registrar o plano B com `pdfjs-dist` num worker dedicado.

**Portão da Fase 0:** `docs/tech/spikes.md` completo e commitado, e a spec atualizada se algum plano B foi escolhido.

---

## Fase 1: Índice de vagas

### Task 1: Scaffold e base do repositório open-source

**Arquivos:**
- **Criar:** `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/globals.css`, `components/ui/*` (shadcn: button, input, select, checkbox, tabs, badge, card, dialog, toast), `vitest.config.ts`, `playwright.config.ts`, `docker-compose.test.yml`, `.env.example`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.github/ISSUE_TEMPLATE/{bug,nova-fonte,novo-provedor}.md`, `.github/pull_request_template.md`
- **Teste:** `tests/unit/smoke.test.ts`

- [ ] **Passo 1:** criar o app com `pnpm create next-app@16.4 . --ts --app --tailwind --eslint --use-pnpm --no-src-dir --import-alias "@/*"` e rodar `pnpm dlx shadcn@latest init`.
- [ ] **Passo 2:** adicionar ao `package.json` os scripts `lint`, `typecheck` (`tsc --noEmit`), `test` (`vitest run --project unit`), `test:integration` (`vitest run --project integration`), `test:e2e` (`playwright test`), `db:test:up` (`docker compose -f docker-compose.test.yml up -d --wait`), `db:generate`, `db:migrate` e `build` (`if [ "$VERCEL_ENV" = production ]; then pnpm db:migrate; fi && next build`).
- [ ] **Passo 3:** configurar o `vitest.config.ts` com dois projetos:
  - `unit`: `tests/unit/**`, ambiente `node`, e `jsdom` para `tests/unit/client/**`.
  - `integration`: `tests/integration/**`, ambiente `node`, `fileParallelism: false`.
- [ ] **Passo 4:** escrever `tests/unit/smoke.test.ts` (`expect(1 + 1).toBe(2)`) e rodar `pnpm test`. Esperado: PASS.
- [ ] **Passo 5:** no `docker-compose.test.yml`, configurar `postgres:17` na porta `54329:5432`, banco `jobfind_test`, usuário e senha `postgres`, com healthcheck.
- [ ] **Passo 6:** no `.github/workflows/ci.yml`, configurar o job `ci` com:
  - `permissions: {}` e actions fixadas por SHA;
  - service container `postgres:17` na porta 54329;
  - etapas `pnpm i --frozen-lockfile`, `lint`, `typecheck`, `test`, `db:migrate` contra o banco de teste, `test:integration`, `build`, `test:e2e` e `pnpm audit --audit-level=high`.
- [ ] **Passo 7:** escrever o `.env.example` com as 4 variáveis aprovadas e um comentário em pt-BR em cada uma.
- [ ] **Passo 8:** escrever o `CONTRIBUTING.md` em pt-BR com as seções "Rodando localmente", "Adicionar uma fonte de vagas" (interface `Connector` da Tarefa 10, fixture em `tests/fixtures/sources/<id>/`, checagem de ToS em `docs/fontes.md`) e "Adicionar um provedor de IA" (entrada em `lib/client/ai/providers.ts` da Tarefa 23, com host incluído na CSP automaticamente).
- [ ] **Passo 9:** verificar. Rodar `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Esperado: tudo verde.
- [ ] **Passo 10:** commitar (`chore: scaffold Next.js 16 e arquivos open-source`).

### Task 2 [P]: Validador de URL compartilhado (SEC-03)

**Arquivos:** criar `lib/shared/url.ts`; teste em `tests/unit/shared/url.test.ts`

**Interfaces:**
- Produz: `safeUrl(input: string, opts?: { allowHttp?: boolean }): string | null`, que devolve a URL normalizada (`new URL().toString()`) ou `null`.

- [ ] **Passo 1:** escrever o teste que falha.

```ts
expect(safeUrl('javascript:alert(1)')).toBeNull()
expect(safeUrl('data:text/html,x')).toBeNull()
expect(safeUrl('http://a.com/x')).toBeNull()
expect(safeUrl('http://a.com/x', { allowHttp: true })).toBe('http://a.com/x')
expect(safeUrl('https://a.com/' + 'x'.repeat(2048))).toBeNull() // > 2048 caracteres
expect(safeUrl('  https://A.com/vaga  ')).toBe('https://a.com/vaga')
```

- [ ] **Passo 2:** rodar `pnpm test tests/unit/shared/url.test.ts`. Esperado: FAIL.
- [ ] **Passo 3:** implementar `safeUrl`. Aceita só `https:` (e `http:` com `allowHttp`) e no máximo 2048 caracteres.
- [ ] **Passo 4:** rodar de novo. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 3 [P]: Dicionário de stacks isomórfico (RF-04, D-08)

**Arquivos:** criar `lib/shared/stacks.ts`; testes em `tests/unit/shared/stacks.test.ts` e na fixture `tests/fixtures/stacks/sample-100.json`

**Interfaces:**
- Produz:
  - `STACKS_VERSION: number`
  - `STACKS: StackDef[]`, com `StackDef = { id: string; label: string; synonyms: string[]; category: 'frontend'|'backend'|'mobile'|'data'|'devops'|'qa'|'lang'|'other'; weight: number; implies?: string[]; adjacent?: string[] }`
  - `normalizeSkill(raw: string): string | null`
  - `extractStacks(input: { title: string; tags?: string[]; body?: string }): { id: string; inTitle: boolean }[]`

- [ ] **Passo 1:** escrever os testes que falham.

```ts
expect(normalizeSkill('ReactJS')).toBe('react')
expect(normalizeSkill('React.js')).toBe('react')
expect(normalizeSkill('Node')).toBe('nodejs')
expect(normalizeSkill('C#')).toBe('csharp')
expect(normalizeSkill('.NET Core')).toBe('dotnet')
expect(normalizeSkill('Golang')).toBe('go')
expect(normalizeSkill('Excel')).toBeNull()
const r = extractStacks({ title: 'Dev Next.js', body: 'Vamos going forward com TypeScript' })
expect(r.map(s => s.id).sort()).toEqual(['nextjs', 'react', 'typescript']) // implies; "going" não vira go
expect(r.find(s => s.id === 'nextjs')?.inTitle).toBe(true)
expect(STACKS.length).toBeGreaterThanOrEqual(60)
// precisão: amostra rotulada à mão, ≥ 90% de acerto por vaga
expect(precision(sample100)).toBeGreaterThanOrEqual(0.9)
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar.
  - Montar um regex por sinônimo com fronteira `(?<![\w.#+-])…(?![\w#+-])`, sem diferenciar maiúsculas.
  - `go` só casa com "Golang", ou com "Go" em maiúscula no título ou nas tags.
  - Aplicar `implies` (`nextjs→react`, `nuxt→vue`, `nestjs→nodejs`) e deduplicar.
  - Definir pesos: 0,5 para stacks genéricas (`git`, `sql`), 1 para o resto.
  - Definir adjacências: `typescript↔javascript`.
  - O dicionário tem pelo menos 60 stacks. Ele precisa incluir as do protótipo (React, Angular, Vue, Next.js, Node.js, TypeScript, Java, Python, Go, .NET, Flutter, Kotlin) e as das vagas típicas.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 4 [P]: Classificadores de enriquecimento (RF-05, RF-06, RN-01, RN-03, RN-04, RN-05, RN-08)

**Arquivos:** criar `lib/shared/types/job.ts` (só os tipos base), `lib/server/enrich/{origin,work-mode,seniority,language,tech,dedupe}.ts`; testes em `tests/unit/server/enrich/*.test.ts`

**Interfaces:**
- Em `lib/shared/types/job.ts`: `WorkMode`, `Seniority` e `SourceId = 'himalayas'|'greenhouse'|'ashby'|'lever'|'jobicy'|'github'|'wwr'|'remoteok'|'hn'|'smartrecruiters'`. As Tarefas 7, 8 e 10 importam daqui.
- `classifyOrigin(i: { country: string|null; locationText: string|null; eligibleRegions: string[]; sourceIsBrazilian: boolean }): { origin: 'national'|'international'|'unknown'; acceptsBrazil: boolean|null }`
- `classifyWorkMode(hint: WorkMode|null, text: string): WorkMode`, com `WorkMode = 'remote'|'hybrid'|'onsite'|'unknown'`
- `detectSeniority(title: string, hint: Seniority|null): Seniority|null`, com `Seniority = 'intern'|'junior'|'mid'|'senior'|'lead'`
- `detectLanguage(text: string): 'pt'|'en'|'es'|'unknown'`, usando `franc-min` com `only: ['por','eng','spa']`; texto com menos de 200 caracteres devolve `'unknown'`
- `isTechJob(title: string, tags: string[]): boolean`
- `dedupeKey(i: { company: string; title: string; country: string|null; city: string|null; workMode: WorkMode }): string` (sha1 hex dos campos normalizados: minúsculas, sem acento, espaços colapsados)
- `contentHash(parts: string[]): string`

- [ ] **Passo 1:** escrever os testes que falham.

```ts
expect(classifyOrigin({ country: 'BR', locationText: 'São Paulo', eligibleRegions: [], sourceIsBrazilian: false })).toEqual({ origin: 'national', acceptsBrazil: true })
expect(classifyOrigin({ country: null, locationText: 'Remote', eligibleRegions: ['LATAM'], sourceIsBrazilian: false })).toEqual({ origin: 'international', acceptsBrazil: true })
expect(classifyOrigin({ country: 'US', locationText: 'Remote - US only', eligibleRegions: ['United States'], sourceIsBrazilian: false })).toEqual({ origin: 'international', acceptsBrazil: false })
expect(classifyOrigin({ country: null, locationText: null, eligibleRegions: [], sourceIsBrazilian: false }).origin).toBe('unknown')
expect(classifyWorkMode(null, 'Vaga 100% home office')).toBe('remote')
expect(classifyWorkMode('onsite', 'remote friendly')).toBe('onsite')          // campo vence texto
expect(classifyWorkMode(null, 'Modelo híbrido, 2x na semana')).toBe('hybrid')
expect(detectSeniority('Desenvolvedor Pleno React', null)).toBe('mid')
expect(detectSeniority('Staff Engineer', null)).toBe('lead')
expect(detectSeniority('Estágio em Dados', null)).toBe('intern')
expect(detectLanguage('curto')).toBe('unknown')
expect(isTechJob('Analista de Marketing', ['marketing'])).toBe(false)
expect(isTechJob('QA Engineer', [])).toBe(true)
expect(dedupeKey({ company: 'Lumen Pay', title: 'Dev  Frontend', country: 'BR', city: 'São Paulo', workMode: 'remote' }))
  .toBe(dedupeKey({ company: 'lumen pay', title: 'dev frontend', country: 'BR', city: 'sao paulo', workMode: 'remote' }))
expect(dedupeKey({ company: 'X', title: 'Dev', country: 'BR', city: 'Recife', workMode: 'onsite' }))
  .not.toBe(dedupeKey({ company: 'X', title: 'Dev', country: 'BR', city: 'Natal', workMode: 'onsite' }))  // RN-05: cidade diferente, vaga diferente
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar. As regras de origem seguem a RN-03 e a D-08: país estruturado vence o texto; remoto "no Brasil" de empresa estrangeira conta como internacional com `acceptsBrazil`; regiões Worldwide/LATAM/Americas/Brazil dão `acceptsBrazil: true`.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 5 [P]: Sanitização do HTML das vagas (SEC-02)

**Arquivos:** criar `lib/server/sanitize.ts` e `lib/client/render-html.ts`; testes em `tests/unit/server/sanitize.test.ts`, `tests/unit/client/render-html.test.ts` e na fixture `tests/fixtures/xss/payloads.txt` (corpus OWASP)

**Interfaces:**
- `SANITIZER_VERSION = 1`
- `sanitizeJobHtml(html: string, opts: { dofollow: boolean }): string`
- `markdownToSafeHtml(md: string): string` (para issues do GitHub; o markdown é renderizado sem HTML cru e depois sanitizado)
- `htmlToText(html: string): string`
- `summarize(html: string, max = 280): string`
- No cliente: `toSafeHtml(html: string): string`, com DOMPurify e a mesma allowlist

- [ ] **Passo 1:** escrever os testes que falham.

```ts
for (const p of payloads) {
  const out = sanitizeJobHtml(p, { dofollow: false })
  expect(out).not.toMatch(/<script|onerror=|onload=|javascript:|<iframe|<svg|<img|style=/i)
}
expect(sanitizeJobHtml('<a href="https://x.com">x</a>', { dofollow: false })).toContain('rel="noopener noreferrer nofollow"')
expect(sanitizeJobHtml('<a href="https://x.com">x</a>', { dofollow: true })).not.toContain('nofollow')
expect(summarize('<p>' + 'a '.repeat(400) + '</p>').length).toBeLessThanOrEqual(280)
// cliente (jsdom): mesmo corpus com toSafeHtml
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar.
  - **Allowlist:** `p, br, ul, ol, li, strong, em, b, i, h3–h6, code, pre, blockquote, a[href]`.
  - **Esquemas permitidos:** `http`, `https`, `mailto`.
  - **Tamanho:** a saída é truncada em 30.000 bytes, fechando as tags abertas.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 6: Schema do banco e migração 0001 (D-03, D-04, D-05)

**Arquivos:** criar `lib/server/db/schema.ts`, `lib/server/db/client.ts`, `drizzle.config.ts`, `drizzle/0001_init.sql` (+ `drizzle/meta`), `tests/integration/setup.ts`; teste em `tests/integration/db/migration.test.ts`

**Interfaces:**
- Produz:
  - as tabelas Drizzle `jobs`, `jobSources`, `sourceState` e `sourceRuns`, espelhando o DDL da seção 5.2 da spec;
  - `getHttpDb(url = process.env.DATABASE_URL!)`, com driver `neon-http`, para leituras;
  - `getPoolDb(url)`, com `neon-serverless` Pool, para o coletor e transações;
  - nos testes, `testDb()` de `tests/integration/setup.ts`, que usa `drizzle-orm/node-postgres` com a URL fixa de teste, roda as migrações e faz `TRUNCATE` entre os testes.
- O tipo `Db` é a união dos tipos usados (`PgDatabase` genérico) e é aceito por todas as funções de `lib/server/jobs/*`.

- [ ] **Passo 1:** escrever o teste que falha.

```ts
const db = await testDb()
const r = await db.execute(sql`select job_search_vector('Dev React','Lumen',array['react'],'pt','Vaga de programação') @@ websearch_to_tsquery('portuguese','programacao') as ok`)
expect(r.rows[0].ok).toBe(true)                     // unaccent + stemming PT
await expect(insertJobRaw(db, { dedupe_key: 'k', expired_at: null })).resolves.toBeDefined()
await expect(insertJobRaw(db, { dedupe_key: 'k', expired_at: null })).rejects.toThrow(/jobs_dedupe_active_uq/)
await expect(insertJobRaw(db, { dedupe_key: 'k', expired_at: new Date() })).resolves.toBeDefined() // índice parcial
```

- [ ] **Passo 2:** rodar `pnpm db:test:up && pnpm test:integration tests/integration/db`. Esperado: FAIL.
- [ ] **Passo 3:** escrever o `schema.ts` e rodar `pnpm drizzle-kit generate --custom --name=init`. Colar o SQL da seção 5.2 da spec no `0001_init.sql` gerado, com a coluna `sanitizer_version` e `cursor` em `source_state` incluídos.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 7 [P com a 8]: Upsert, expiração e retenção (RF-02, RF-03, RF-07, D-04)

**Arquivos:** criar `lib/server/sources/types.ts` (só `NormalizedJob`; a Tarefa 10 completa o arquivo), `lib/server/jobs/upsert.ts`, `lib/server/jobs/expire.ts` e `lib/server/jobs/enrich-job.ts`; testes em `tests/integration/jobs/upsert.test.ts` e `tests/integration/jobs/expire.test.ts`

**Interfaces:**
- Consome: Tarefas 3, 4, 5 e 6, e `NormalizedJob` (definido aqui, em `lib/server/sources/types.ts`, e reaproveitado pela Tarefa 10):

```ts
type NormalizedJob = {
  externalId: string; url: string; title: string; company: string; companyLogoUrl: string | null
  descriptionHtml: string; descriptionFormat: 'html' | 'markdown'
  country: string | null; city: string | null; locationText: string | null; eligibleRegions: string[]
  workModeHint: WorkMode | null; seniorityHint: Seniority | null; tags: string[]
  salary: { min: number | null; max: number | null; currency: string; period: 'hour' | 'month' | 'year' } | null
  publishedAt: Date | null
}
```

- Produz:
  - `enrichJob(n: NormalizedJob, src: { id: SourceId; brazilian: boolean; dofollow: boolean }): EnrichedJob | null`, que devolve `null` quando a vaga não é de tecnologia (RN-01) ou a URL é inválida;
  - `upsertJob(db: Db, job: EnrichedJob, ref: { source: SourceId; externalId: string; url: string }, now: Date): Promise<{ jobId: bigint; status: 'inserted' | 'updated' | 'unchanged' }>`;
  - `markMissedRuns(db, source: SourceId, runStartedAt: Date, fetchedCount: number, previousCount: number | null): Promise<number>`;
  - `expireJobs(db, now: Date): Promise<number>`;
  - `purgeExpired(db, now: Date): Promise<number>`.

- [ ] **Passo 1:** escrever os testes que falham (`upsert.test.ts`).

```ts
const a = await upsertJob(db, job, ref, t0); expect(a.status).toBe('inserted')
const b = await upsertJob(db, job, ref, t1); expect(b.status).toBe('unchanged'); expect(b.jobId).toBe(a.jobId)
const c = await upsertJob(db, { ...job, title: job.title + ' ' }, ref2 /* outra fonte, mesmo dedupe */, t1)
expect(c.jobId).toBe(a.jobId); expect((await getRow(a.jobId)).sources).toEqual(['greenhouse', 'himalayas'])
// published_at nunca sobe, futuro vira now, ausente vira first_seen (Foco de revisão 4)
await upsertJob(db, { ...job, publishedAt: addDays(job.publishedAt, 3) }, ref, t2); expect((await getRow(a.jobId)).published_at).toEqual(job.publishedAt)
const f = await upsertJob(db, { ...job2, publishedAt: addDays(t0, 10) }, ref3, t0); expect((await getRow(f.jobId)).published_at).toEqual(t0)
const g = await upsertJob(db, { ...job3, publishedAt: null }, ref4, t0); expect((await getRow(g.jobId)).published_at).toEqual(t0)
// janela de 30 dias (RN-05)
const d = await upsertJob(db, job, refNew, addDays(t0, 31)); expect(d.jobId).not.toBe(a.jobId); expect((await getRow(a.jobId)).expired_at).not.toBeNull()
```

- [ ] **Passo 2:** escrever os testes que falham (`expire.test.ts`).

```ts
// fonte que voltou vazia ou parcial não expira nada (Foco de revisão 1)
expect(await markMissedRuns(db, 'greenhouse', runStart, 0, 400)).toBe(0)
expect(await markMissedRuns(db, 'greenhouse', runStart, 150, 400)).toBe(0)   // < 50%
expect(await markMissedRuns(db, 'greenhouse', runStart, 390, 400)).toBeGreaterThan(0)
// 3 coletas sem ver em NENHUMA fonte → expira; ainda vista em outra fonte → continua
// mais de 45 dias → expira; purge apaga expiradas há mais de 30 dias
```

- [ ] **Passo 3:** rodar `pnpm test:integration tests/integration/jobs`. Esperado: FAIL.
- [ ] **Passo 4:** implementar.
  - **Upsert:** `INSERT … ON CONFLICT (dedupe_key) WHERE expired_at IS NULL DO UPDATE … WHERE content_hash IS DISTINCT FROM … OR NOT (EXCLUDED.sources <@ jobs.sources)` com `published_at = LEAST(...)`, conforme a seção 5.2 da spec. Antes do upsert, resolver por `job_sources(source, external_id)` e por `url_canonical`. Fazer upsert em `job_sources` com `last_seen_at = now` e `missed_runs = 0`.
  - **Sem linha retornada:** buscar o `id` pelo `dedupe_key` e devolver o status `unchanged`.
  - **`enrichJob`:**
    - sanitiza o HTML só quando o `contentHash` bruto difere do salvo; o chamador passa o hash salvo pelo lookup;
    - quando `descriptionFormat` é `'markdown'`, usa `markdownToSafeHtml`;
    - calcula `searchBody` com `htmlToText`.
- [ ] **Passo 5:** rodar o teste. Esperado: PASS.
- [ ] **Passo 6:** commitar.

### Task 8 [P com a 7]: Query de listagem com cursor e filtros (RF-08, RF-09, RF-10, D-05)

**Arquivos:** criar `lib/shared/schemas/jobs-query.ts` e `lib/shared/jobs-url.ts`; modificar `lib/shared/types/job.ts` (acrescenta `JobSummary` e `JobDetail`); criar `lib/server/jobs/cursor.ts` e `lib/server/jobs/query.ts`; testes em `tests/unit/shared/jobs-query.test.ts`, `tests/unit/shared/jobs-url.test.ts` e `tests/integration/jobs/query.test.ts`

**Interfaces:**
- `JobsQuery` (zod):

  | Campo | Tipo |
  |---|---|
  | `q?` | string, `trim`, 1–100 caracteres |
  | `stacks?` | `string[]`, até 10, normalizados pela Tarefa 3 |
  | `stacksMode` | `'any' \| 'all'` (padrão `'any'`) |
  | `origin?` | `'national' \| 'international'` |
  | `acceptsBrazil?` | boolean |
  | `workMode?` | `WorkMode` sem `unknown` |
  | `seniority?` | `Seniority[]` |
  | `lang?` | `'pt' \| 'en' \| 'es'` |
  | `since?` | `'24h' \| '7d' \| '30d'` |
  | `source?` | `SourceId[]` |
  | `cursor?` | string |
  | `limit` | 1–90 (padrão 30) |

  - `parseJobsQuery(sp: URLSearchParams): { ok: true; value: JobsQuery } | { ok: false; error: { code: 'invalid_query'; message: string } }`
- `JobSummary` e `JobDetail` ficam em `lib/shared/types/job.ts`. Os campos são as colunas do SELECT da seção 5.3 da spec, mais `attribution: { source: SourceId; label: string; url: string; dofollow: boolean }[]` no `JobDetail`.
- `buildJobsUrl(q: Partial<JobsQuery>): string` gera a URL canônica: chaves em ordem alfabética, arrays ordenados, valores padrão omitidos.
- `encodeCursor({ publishedAt: Date; id: bigint }): string` (base64url) e `decodeCursor(s: string): { publishedAt: Date; id: bigint } | null`
- `listJobs(db: Db, q: JobsQuery, withCounts: boolean): Promise<{ items: JobSummary[]; nextCursor: string | null; counts?: { all: number; remote: number; hybrid: number; onsite: number } }>`
- `getJob(db: Db, id: bigint): Promise<JobDetail | null>`

- [ ] **Passo 1:** escrever os testes unitários que falham.

```ts
expect(buildJobsUrl({ stacks: ['vue', 'react'], stacksMode: 'any', limit: 30 })).toBe('/api/jobs?stacks=react%2Cvue')
expect(parseJobsQuery(new URLSearchParams('q=' + 'x'.repeat(101))).ok).toBe(false)
expect(parseJobsQuery(new URLSearchParams('limit=500')).ok).toBe(false)
expect(decodeCursor('lixo')).toBeNull()
```

- [ ] **Passo 2:** escrever os testes de integração que falham. O seed tem 40 vagas variadas, e os empates de `published_at` são intencionais.

```ts
const p1 = await listJobs(db, q({}), true)
expect(p1.items).toHaveLength(30); expect(isSortedDesc(p1.items)).toBe(true); expect(p1.counts!.all).toBe(40)
const p2 = await listJobs(db, q({ cursor: p1.nextCursor! }), false)
expect(p2.items).toHaveLength(10); expect(intersect(p1.items, p2.items)).toHaveLength(0); expect(p2.nextCursor).toBeNull()
expect(every(await listJobs(db, q({ stacks: ['react', 'vue'] }), false), j => j.stacks.includes('react') || j.stacks.includes('vue'))).toBe(true)
expect(every(await listJobs(db, q({ stacks: ['react', 'typescript'], stacksMode: 'all' }), false), j => j.stacks.includes('react') && j.stacks.includes('typescript'))).toBe(true)
expect(every(await listJobs(db, q({ origin: 'national' }), false), j => j.origin === 'national')).toBe(true)
expect((await listJobs(db, q({ q: 'programacao' }), false)).items.length).toBeGreaterThan(0)   // sem acento acha "programação"
for (const s of ['C#', 'node.js', '"São Paulo"', "'", '&', '   ']) await expect(listJobs(db, q({ q: s }), false)).resolves.toBeDefined() // Foco de revisão 2
// vagas expiradas nunca aparecem
```

- [ ] **Passo 3:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 4:** implementar.
  - Montar o SQL só com os predicados dos filtros presentes, sem `$x IS NULL OR`.
  - Usar `SET LOCAL statement_timeout = '3s'`.
  - Buscar `LIMIT limit+1`.
  - Fazer os contadores no mesmo `db.batch()` quando `withCounts`.
  - Um `q` só com espaços vira `undefined` no `parseJobsQuery`.
- [ ] **Passo 5:** rodar o teste. Esperado: PASS.
- [ ] **Passo 6:** commitar.

### Task 9: Rotas `GET /api/jobs` e `GET /api/jobs/[id]` (D-06)

**Arquivos:** criar `app/api/jobs/route.ts` e `app/api/jobs/[id]/route.ts`; teste em `tests/integration/api/jobs-route.test.ts`

**Interfaces:**
- Consome: `parseJobsQuery`, `listJobs`, `getJob` e `getHttpDb`.
- Produz:
  - resposta 200 `{ items, nextCursor, counts?, lastCollectedAt }`; os `counts` só vêm quando não há `cursor`;
  - erro 400 `{ error: { code, message } }`;
  - erro 404 para vaga inexistente;
  - headers `Vercel-CDN-Cache-Control: max-age=900, stale-while-revalidate=86400, stale-if-error=86400`, `Vercel-Cache-Tag: jobs` (detalhe: `jobs,job-<id>`) e `Cache-Control: public, max-age=30`.

- [ ] **Passo 1:** escrever o teste que falha. Ele chama o `GET` exportado com `new Request(...)`.

```ts
const res = await GET(new Request('http://x/api/jobs?limit=500'))
expect(res.status).toBe(400); expect(await res.json()).toEqual({ error: { code: 'invalid_query', message: expect.any(String) } })
const ok = await GET(new Request('http://x/api/jobs'))
expect(ok.headers.get('Vercel-Cache-Tag')).toBe('jobs')
expect(ok.headers.get('Vercel-CDN-Cache-Control')).toContain('stale-if-error=86400')
expect((await ok.json()).counts).toBeDefined()
expect((await GET(new Request('http://x/api/jobs/999999'), { params: Promise.resolve({ id: '999999' }) })).status).toBe(404)
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar. Erros inesperados devolvem 500 com o corpo `{ error: { code: 'internal' } }`, sem stack trace.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 10: Base dos conectores e fetch seguro (D-07, SEC-06)

**Arquivos:** criar `lib/server/sources/types.ts` (completa o tipo da Tarefa 7), `lib/server/sources/http.ts` e `lib/server/sources/registry.ts`; teste em `tests/unit/server/sources/http.test.ts`

**Interfaces:**
- `SourceId` vem de `lib/shared/types/job.ts` (Tarefa 4).
- O `Connector` tem os campos:

  | Campo | Tipo |
  |---|---|
  | `id` | `SourceId` |
  | `brazilian` | boolean |
  | `fullSnapshot` | boolean |
  | `minIntervalMinutes` | number |
  | `attribution` | `{ label: string; url: string; dofollow: boolean }` |
  | `fetch` | `(ctx: ConnectorContext) => AsyncIterable<unknown>` |
  | `normalize` | `(raw: unknown) => NormalizedJob \| null` |

- `ConnectorContext = { fetchJson: SafeFetch; fetchText: SafeFetch; cursor: string | null; setCursor(c: string | null): void; signal: AbortSignal; now: Date }`
- `createSafeFetch(allowedHosts: string[], opts?: { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> }): SafeFetch`, com padrão de 20.000 ms e 10 MB e retry 1x com backoff em 5xx/429
- `CONNECTORS: Record<SourceId, Connector>` em `registry.ts` (começa vazio e é preenchido pelas Tarefas 11–14 e 38)

- [ ] **Passo 1:** escrever o teste que falha, com `undici` `MockAgent`.

```ts
const f = createSafeFetch(['api.example.com'])
await expect(f('https://evil.com/x')).rejects.toThrow(/host não permitido/)
mock.intercept({ path: '/r' }).reply(302, '', { headers: { location: 'http://169.254.169.254/' } })
await expect(f('https://api.example.com/r')).rejects.toThrow(/redirect/)
mock.intercept({ path: '/big' }).reply(200, 'x'.repeat(11 * 1024 * 1024))
await expect(f('https://api.example.com/big')).rejects.toThrow(/tamanho/)
mock.intercept({ path: '/slow' }).reply(200, 'ok').delay(25_000)
await expect(createSafeFetch(['api.example.com'], { timeoutMs: 100 })('https://api.example.com/slow')).rejects.toThrow(/timeout/)
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar. Redirects só são seguidos para hosts da allowlist, com no máximo 3 saltos.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 11: Conectores do MVP — Tarefas 11 a 14 [P] (Himalayas, Greenhouse, Ashby e Lever, Jobicy)

Todas seguem o mesmo molde. Cada uma cria `lib/server/sources/<id>.ts`, registra o conector em `registry.ts`, salva uma fixture real em `tests/fixtures/sources/<id>/*.json` (baixada uma vez com `curl` e commitada) e escreve o teste `tests/unit/server/sources/<id>.test.ts`. Os endpoints, a atribuição e o tipo de snapshot estão na tabela da D-07 da spec.

**Teste comum (escrever primeiro, ver falhar, implementar, ver passar, commitar):**

```ts
const raws = await collect(connector.fetch(fakeCtx(fixture)))   // fakeCtx serve a fixture em vez de rede
const jobs = raws.map(connector.normalize).filter(Boolean)
expect(jobs.length).toBeGreaterThan(0)
for (const j of jobs) { expect(j!.externalId).toBeTruthy(); expect(safeUrl(j!.url, { allowHttp: true })).not.toBeNull(); expect(j!.title).toBeTruthy() }
expect(connector.normalize({ lixo: true })).toBeNull()          // payload inválido no Zod vira null, não exceção
```

**Asserções específicas de cada conector:**

- **Tarefa 11, Himalayas:** usa `fullSnapshot: false`.
  - **Paginação:** por `cursor`, parando no `guid` salvo em `ctx.cursor`. O conector chama `setCursor` com o `guid` mais novo.
  - **Elegibilidade:** `locationRestrictions` vai para `eligibleRegions`.
  - **Chave:** usa o header `Authorization: Bearer ${process.env.HIMALAYAS_API_KEY}` quando a variável existe.
  - **Asserção específica:** uma fixture com `locationRestrictions: ['Brazil']` gera `eligibleRegions` contendo `'Brazil'`.
- **Tarefa 12, Greenhouse:** a lista de slugs fica em `lib/server/sources/greenhouse.ts` (`GREENHOUSE_BOARDS`, com os slugs da D-07).
  - **Coleta:** chama `GET boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` para cada slug, com concorrência 3.
  - **Local:** `location.name` passa por um parser que extrai `country`, `city` e o modelo de trabalho.
  - **Falha de um slug:** um 404 num slug não derruba os outros (asserção).
- **Tarefa 13, Ashby e Lever:** são dois conectores no mesmo PR.
  - **Campos estruturados:** os dois usam `workplaceType` e o país estruturado.
  - **Ashby:** usa `includeCompensation=true` e preenche `salary`.
  - **Lever:** preenche `salary` a partir de `salaryRange`.
  - **Asserção específica:** `workplaceType: 'remote'` gera `workModeHint: 'remote'`.
- **Tarefa 14, Jobicy:** usa `fullSnapshot: false` e `minIntervalMinutes: 60`.
  - **Coleta:** busca `geo=brazil` e `geo=latam` com `industry=engineering`.
  - **Link da vaga:** `url` aponta para a página do Jobicy, que exige isso.
  - **Asserção específica:** `url` começa com `https://jobicy.com/`.

**Verificação do grupo:** `pnpm test tests/unit/server/sources`. Esperado: PASS.

### Task 15: Orquestrador da coleta (RF-01, RNF-03, RNF-04, D-07)

**Arquivos:** criar `lib/server/collect/run.ts` e `lib/server/collect/lock.ts`; teste em `tests/integration/collect/run.test.ts`

**Interfaces:**
- Consome: `CONNECTORS`, `enrichJob`, `upsertJob`, `markMissedRuns`, `expireJobs`, `purgeExpired` e `getPoolDb`.
- Produz:
  - `runCollection(opts: { db: Db; sources: SourceId[]; now: Date; budgetMs?: number; concurrency?: number; connectors?: Record<SourceId, Connector>; invalidate?: (tag: string) => Promise<void> }): Promise<SourceRunResult[]>`, com padrões `budgetMs = 240_000` e `concurrency = 5`;
  - `SourceRunResult = { source; status: 'ok'|'error'|'skipped'; fetched; inserted; updated; expired; error?: string }`;
  - `acquireLock(db, source, ttlMs): Promise<boolean>` e `releaseLock(db, source)`.

- [ ] **Passo 1:** escrever o teste que falha, com conectores falsos injetados.

```ts
const res = await runCollection({ db, sources: ['a', 'b'], now, connectors: { a: okConn(5), b: throwingConn() }, invalidate })
expect(res.find(r => r.source === 'a')!.status).toBe('ok')
expect(res.find(r => r.source === 'b')!.status).toBe('error')
expect(await countJobs(db)).toBe(5)
expect((await state(db, 'b')).consecutive_failures).toBe(1)
expect(invalidate).toHaveBeenCalledWith('jobs')
await runCollection({ db, sources: ['a'], now, connectors: { a: okConn(5) }, invalidate: inv2 })
expect(inv2).not.toHaveBeenCalled()                                                   // sem mudança, sem invalidação
await acquireLock(db, 'a', 60_000)
expect((await runCollection({ db, sources: ['a'], now, connectors: { a: okConn(1) } }))[0].status).toBe('skipped')
// minIntervalMinutes: fonte rodada há 10 min com min 60 → skipped
// um conector lento é cortado pelo timeout de 20 s e não estoura o budget
// a execução das 03:17 chama purgeExpired
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar.
  - **Execução:** `Promise.allSettled` com um limitador de concorrência simples. Cada fonte roda numa transação curta por lote de 100 vagas.
  - **Registro:** grava `source_runs` (`running` → `ok`/`error`) e atualiza `source_state` (`last_success_at`, `last_fetched_count`, `consecutive_failures` e `cursor`).
  - **Expiração:** `markMissedRuns` só para fontes `fullSnapshot` com status `ok`; `expireJobs` sempre roda ao final.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 16: Rota `/api/cron/collect` e agendamento (SEC-04, D-02)

**Arquivos:** criar `lib/server/cron-auth.ts`, `app/api/cron/collect/route.ts` e a configuração de agendamento definida na Tarefa 0.1 (`vercel.json` ou `.github/workflows/collect.yml`); teste em `tests/unit/server/cron-auth.test.ts`

**Interfaces:**
- `verifyCronSecret(header: string | null, secret: string): boolean`, com `timingSafeEqual(sha256(a), sha256(b))`
- A rota `GET|POST` responde:
  - 401 sem segredo ou com segredo errado;
  - 400 para `sources` desconhecida;
  - 202 `{ accepted: SourceId[] }`, rodando o `runCollection` dentro de `after()`.
- Configuração da rota: `export const maxDuration = 300`.

- [ ] **Passo 1:** escrever o teste que falha.

```ts
expect(verifyCronSecret(null, 's')).toBe(false)
expect(verifyCronSecret('Bearer x', 's')).toBe(false)
expect(verifyCronSecret('Bearer ' + 'a'.repeat(32), 'b'.repeat(32))).toBe(false)
expect(verifyCronSecret('Bearer s3cr3t', 's3cr3t')).toBe(true)
// rota: sem header → 401; ?sources=foo → 400; header ok → 202
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar. A verificação acontece no próprio route handler, nunca no middleware.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 17: Headers de segurança e CSP (SEC-01, SEC-07, D-15, D-17)

**Arquivos:** modificar `next.config.ts`; criar `lib/shared/csp.ts`; teste em `tests/unit/shared/csp.test.ts`

**Interfaces:**
- `buildCsp(aiHosts: string[]): string` monta as diretivas da D-15. O `connect-src` é `'self'` mais `aiHosts`.
- O `next.config.ts` importa a lista de hosts de `lib/shared/ai-hosts.ts` (`AI_CSP_HOSTS: string[]`). A Tarefa 23 lê o mesmo arquivo, para que a lista exista num lugar só.
- Usar `experimental.sri` ou nonce conforme o resultado da Tarefa 0.2.

- [ ] **Passo 1:** escrever o teste que falha.

```ts
const csp = buildCsp(AI_CSP_HOSTS)
expect(csp).toContain("object-src 'none'"); expect(csp).toContain("frame-ancestors 'none'")
expect(csp).toMatch(/connect-src 'self' .*https:\/\/openrouter\.ai/)
expect(csp).not.toMatch(/connect-src[^;]* https: /)          // nunca https: genérico
expect(csp).not.toContain("'unsafe-eval'")
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar. Aplicar via `headers()` a CSP e os headers da SEC-07 (HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP e `X-Frame-Options`).
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 18 [P com a 19]: Home de vagas (US-01, US-02, D-01, D-16)

**Arquivos:**
- Criar: `app/(site)/page.tsx`, `app/providers.tsx` (QueryClient e NuqsAdapter), `components/layout/{SiteHeader,SiteFooter}.tsx`, `components/jobs/{JobsPage,SearchBar,StackChips,FiltersPanel,ModeTabs,JobCard,ChanceBadge}.tsx` e `lib/client/jobs/use-jobs.ts`
- Testes: `tests/unit/client/use-jobs.test.ts`, `tests/e2e/home.spec.ts` e `tests/e2e/seed.ts`

**Interfaces:**
- Consome: `buildJobsUrl`, `JobsQuery`, `JobSummary` e o endpoint da Tarefa 9.
- Produz:
  - `useJobsFilters(): [Partial<JobsQuery>, (patch: Partial<JobsQuery>) => void]`, sobre o nuqs, com as mesmas chaves do `JobsQuery`;
  - `useJobs(filters): UseInfiniteQueryResult<JobsPage>`.
  - O `ChanceBadge` recebe `{ band: 'alta'|'media'|'baixa'|null; score?: number }` e mostra "Importe seu currículo para ver" quando `band` é `null`. As cores seguem o protótipo: Alta `#0B6B5C` sobre branco, Média `#E3F1EE`/`#0A5A4D`, Baixa `#EEEDEA`/`#4A4F5A`.

- [ ] **Passo 1:** escrever o teste unitário que falha. `useJobs` monta a URL canônica e passa o `cursor` da página anterior.
- [ ] **Passo 2:** escrever o E2E que falha, contra o seed via `upsertJob` com 40 vagas.
  - **Ordem:** a lista aparece em ordem decrescente de data.
  - **Filtros na URL:** clicar no chip "React" põe `stacks=react` na URL e todos os cards mostram React.
  - **Origem:** "Nacional" filtra.
  - **Abas:** os contadores aparecem; clicar em "Remoto" filtra e mantém a ordem.
  - **Estado vazio:** sem resultados aparece "Limpar filtros", e o botão limpa a URL.
  - **Rolagem:** "Carregar mais" traz a página 2 sem repetir vagas.
  - **Coleta atrasada:** com a última coleta há mais de 3 h, aparece o aviso com o horário.
- [ ] **Passo 3:** rodar `pnpm test:e2e tests/e2e/home.spec.ts`. Esperado: FAIL.
- [ ] **Passo 4:** implementar seguindo a tela "Vagas (home)" do protótipo (layout, textos e estados de carregamento, vazio e erro). A página é um shell estático; os dados vêm do cliente.
- [ ] **Passo 5:** rodar `pnpm test && pnpm test:e2e tests/e2e/home.spec.ts`. Esperado: PASS.
- [ ] **Passo 6:** commitar.

### Task 19 [P com a 18]: Detalhe da vaga (RN-10)

**Arquivos:** criar `app/(site)/vagas/[id]/page.tsx` e `components/jobs/JobDetail.tsx`; teste em `tests/e2e/job-detail.spec.ts`

- [ ] **Passo 1:** escrever o E2E que falha.
  - **Conteúdo:** a página mostra título, empresa, chips e descrição renderizada via `toSafeHtml`.
  - **Atribuição:** mostra "coletada de Greenhouse", com link para a URL original, e o link de candidatura abre a fonte.
  - **XSS:** uma vaga do seed com `<img onerror>` na descrição não executa script; o E2E usa `page.on('dialog')`.
  - **Vaga inexistente:** mostra "Vaga não encontrada" com link para a lista.
- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar seguindo a tela "Detalhe da vaga" do protótipo. As seções "Sua chance" e "Análise com IA" ficam como placeholders até as Tarefas 29 e 30.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 20: Fontes documentadas, WAF e fechamento da Fase 1

**Arquivos:** criar `docs/fontes.md`

- [ ] **Passo 1:** escrever o `docs/fontes.md`, com uma linha por fonte: endpoint, ToS (link e data da checagem), atribuição exigida, `fullSnapshot` e limites.
- [ ] **Passo 2 (manual, Jaymes ou executor com acesso):** no painel da Vercel, provisionar o Neon via Marketplace (região `gru1`/`sa-east-1`, máximo de 0,25 CU), configurar as 4 variáveis e criar a regra do WAF: `/api/*`, 120 requisições/60 s por IP, resposta 429.
- [ ] **Passo 3:** fazer o deploy, disparar a coleta manualmente (`curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/collect`) e conferir `source_runs`.
- [ ] **Passo 4:** verificar a fase com `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm test:e2e`. Esperado: tudo verde.
- [ ] **Passo 5:** commitar.

**Portão da Fase 1** (critérios da spec):
- 1.000 ou mais vagas ativas em produção depois de 24 h;
- atraso p90 da coleta de até 2 h;
- US-01 e US-02 verdes;
- `/api/jobs` com p95 de até 500 ms sem cache (medido com `autocannon` contra a rota sem cache).

---

## Fase 2: Perfil, IA e chance

### Task 21: Store do localStorage (D-09, RNF-10)

**Arquivos:** criar `lib/client/storage/store.ts` e `lib/client/storage/keys.ts`; teste em `tests/unit/client/storage.test.ts`

**Interfaces:**
- `createStore<T>(key: StorageKey, schema: z.ZodType<T>, opts: { version: number; migrations?: Record<number, (old: unknown) => unknown>; initial: T }): Store<T>`
- `Store<T> = { get(): T; set(v: T): SetResult; subscribe(cb: () => void): () => void }`
- `SetResult = { ok: true } | { ok: false; reason: 'quota' | 'unavailable' }`
- `useStore<T>(s: Store<T>): T | null`, sobre `useSyncExternalStore`, com `getServerSnapshot` devolvendo `null`
- `StorageKey = 'jobfind:v1:ai'|'jobfind:v1:profile'|'jobfind:v1:jobState'|'jobfind:v1:aiAnalysis'|'jobfind:v1:generatedDocs'|'jobfind:v1:savedFilters'|'jobfind:v1:lastVisit'`
- `storageUsageBytes(): number`

- [ ] **Passo 1:** escrever o teste que falha (jsdom).

```ts
const s = createStore('jobfind:v1:profile', z.object({ a: z.number() }).strict(), { version: 1, initial: { a: 0 } })
expect(s.get()).toEqual({ a: 0 })
localStorage.setItem('jobfind:v1:profile', JSON.stringify({ v: 1, data: { a: 1, __proto__: { x: 1 } } }))
expect(s.get()).toEqual({ a: 0 })                                       // inválido → initial, sem quebrar
localStorage.setItem('jobfind:v1:profile', JSON.stringify({ v: 0, data: { b: 2 } }))
expect(createStore(..., { version: 1, migrations: { 0: (o: any) => ({ a: o.b }) }, ... }).get()).toEqual({ a: 2 })
vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('', 'QuotaExceededError') })
expect(s.set({ a: 3 })).toEqual({ ok: false, reason: 'quota' })        // Foco de revisão 3
vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('SecurityError') })
expect(s.get()).toEqual({ a: 0 }); expect(s.set({ a: 1 })).toEqual({ ok: false, reason: 'unavailable' })
// o evento 'storage' de outra aba notifica os subscribers
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar. O formato gravado é `{ v: number, data: T }`. A leitura passa por `JSON.parse`, depois pela migração e depois pelo `schema.safeParse`.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 22: Avisos de armazenamento na interface (Foco de revisão 3, RNF-10)

**Arquivos:** criar `components/layout/StorageBanner.tsx`; teste em `tests/unit/client/storage-banner.test.tsx`

- [ ] **Passo 1:** escrever o teste que falha.
  - Com storage indisponível, o banner mostra "Não foi possível salvar neste navegador. A busca de vagas funciona normalmente."
  - Com `storageUsageBytes()` acima de 4 MB, mostra "Seus dados estão perto do limite. Exporte um backup e apague CVs antigos." com link para Configurações.
- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar o banner e incluí-lo no layout `(local)` e na home.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 23: Registro de provedores de IA e configuração (D-17)

**Arquivos:**
- Modificar: `lib/shared/ai-hosts.ts` (criado na Tarefa 17; a lista passa a ser gerada dos `cspHosts` do registro, ou mantida igual a eles, o que o teste garante)
- Criar: `lib/client/ai/providers.ts`, `lib/client/ai/settings.ts` e `lib/client/ai/model.ts`
- Testes: `tests/unit/client/ai/providers.test.ts` e `tests/unit/client/ai/model.test.ts`

**Interfaces:**
- `ProviderId = 'openrouter'|'openai'|'anthropic'|'google'|'deepseek'|'local'|'groq'|'mistral'|'cerebras'|'xai'|'together'|'fireworks'|'huggingface'|'vercel-gateway'`
- O `ProviderDef` tem os campos:

  | Campo | Tipo |
  |---|---|
  | `id` | `ProviderId` |
  | `label` | string |
  | `tier` | `'must' \| 'should'` |
  | `baseURL` | string |
  | `editableBaseURL` | boolean |
  | `cors` | `'yes' \| 'needs-header' \| 'local-config'` |
  | `structured` | `'json_schema' \| 'tool' \| 'json_mode'` |
  | `auth` | `'pkce' \| 'paste' \| 'none'` |
  | `keyDocsUrl` | string |
  | `privacyNote` | `string \| null` |
  | `cspHosts` | `string[]` |
  | `defaultModels` | `Record<AiTask, string>` |
  | `create` | `(cfg: { apiKey?: string; baseURL?: string }) => Promise<ProviderV3>` (`import()` do pacote) |
  | `listModels` | `(cfg) => Promise<{ id: string; label: string; priceIn?: number; priceOut?: number }[]>` |

- `PROVIDERS: Record<ProviderId, ProviderDef>`
- `AiTask = 'extract'|'analyze'|'cv'`
- `AiSettings` (zod):
  - `providers: Partial<Record<ProviderId, { key?: string; baseURL?: string; addedAt: string; source: 'pkce'|'paste'; privacyAccepted?: boolean }>>`
  - `tasks: Record<AiTask, { provider: ProviderId; model: string } | null>`
  - `dataCollectionDeny: boolean` (padrão `true`)
  - `minimizePii: boolean` (padrão `true`)
- `aiSettingsStore` vem de `createStore('jobfind:v1:ai', ...)`.
- `resolveTaskModel(s: AiSettings, task: AiTask): Promise<{ model: LanguageModel; provider: ProviderDef; modelId: string }>`, que lança `AiError('no_provider')` quando não há provedor conectado.

- [ ] **Passo 1:** escrever os testes que falham.

```ts
expect(Object.values(PROVIDERS).filter(p => p.tier === 'must').map(p => p.id).sort())
  .toEqual(['anthropic', 'deepseek', 'google', 'local', 'openai', 'openrouter'])
expect(PROVIDERS.openrouter.auth).toBe('pkce')
expect(PROVIDERS.openrouter.defaultModels.analyze).toBe('deepseek/deepseek-v4.1-flash')
// a CSP cobre exatamente os hosts do registro
expect(new Set(Object.values(PROVIDERS).flatMap(p => p.cspHosts))).toEqual(new Set(AI_CSP_HOSTS))
expect(PROVIDERS.anthropic.cors).toBe('needs-header')
await expect(resolveTaskModel(emptySettings, 'cv')).rejects.toMatchObject({ code: 'no_provider' })
// um provedor 'local' com baseURL fora de loopback é rejeitado no schema (pergunta 7 da spec: só loopback)
expect(AiSettings.safeParse(withLocal('https://evil.com')).success).toBe(false)
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar.
  - **Valores do spike:** o `structured` de cada provedor vem da tabela da Tarefa 0.3.
  - **Anthropic:** passa `headers: { 'anthropic-dangerous-direct-browser-access': 'true' }`.
  - **Local:** usa `@ai-sdk/openai-compatible` com um `fetch` customizado que passa `targetAddressSpace: 'loopback'`.
  - **Provedores Should:** usam `openai-compatible`.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 24: Geração estruturada com fallback e erros (D-11, D-17, Foco de revisão 5)

**Arquivos:** criar `lib/client/ai/errors.ts`, `lib/client/ai/generate.ts` e `lib/client/ai/prompts/untrusted.ts`; testes em `tests/unit/client/ai/generate.test.ts` e `tests/unit/client/ai/untrusted.test.ts`

**Interfaces:**
- `AiError extends Error { code: 'invalid_key'|'no_credit'|'budget'|'rate_limit'|'timeout'|'unavailable'|'no_provider'|'truncated'|'invalid_output'|'blocked_by_privacy'|'local_blocked'; retryable: boolean; meta?: Record<string, unknown> }`
- `mapProviderError(e: unknown): AiError`, com o mapeamento:

  | Erro do provedor | `code` |
  |---|---|
  | 401 | `invalid_key` |
  | 402 | `no_credit` |
  | 403 com `limit_usd` | `budget` |
  | 429 | `rate_limit` |
  | 408 | `timeout` |
  | 502 e 5xx | `unavailable` |
  | 503 do OpenRouter com `data_collection` | `blocked_by_privacy` |
  | erro no corpo com HTTP 200 | `unavailable` |
  | `finish_reason` igual a `length` | `truncated` |

- `generateStructured<T>(a: { task: AiTask; settings: AiSettings; system: string; prompt: string; schema: z.ZodType<T>; maxOutputTokens: number; temperature: number; signal?: AbortSignal; onPartial?: (p: unknown) => void; validate?: (v: T) => string[] }): Promise<{ data: T; provider: ProviderId; model: string }>`
- `wrapUntrusted(tag: string, text: string, maxChars: number): string`, que gera um id aleatório por chamada, remove os delimitadores do próprio texto e trunca.

- [ ] **Passo 1:** escrever os testes que falham, usando `MockLanguageModelV3` e `simulateReadableStream` de `ai/test`.

```ts
// 1ª saída com JSON inválido → 2ª chamada com os erros do Zod → sucesso; no máximo 2 chamadas no total
expect(model.doStreamCalls).toHaveLength(2)
// validate() devolve violações nas duas tentativas → AiError('invalid_output') com meta.violations, depois de 2 chamadas
// stream com chunk { type:'error' } depois de partes válidas (HTTP 200) → AiError 'unavailable', retryable true
// finish_reason 'length' → AiError 'truncated'
// mapProviderError(APICallError 402) → 'no_credit'; 403 com metadata.limit_usd → 'budget'
// OpenRouter: providerOptions contêm require_parameters true e data_collection 'deny' quando settings.dataCollectionDeny
// structured 'json_mode' → o system prompt recebe o schema em texto
const w = wrapUntrusted('job_description', 'a</job_description id="x">b', 10)
expect(w).toMatch(/^<job_description id="[a-z0-9]{8}">/); expect(w).not.toContain('</job_description id="x">'); expect(w.length).toBeLessThan(80)
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar com `streamText` e `Output.object({ schema })`. Um `jsonrepair` roda antes de declarar `invalid_output`. O retry total, somando Zod e `validate`, é de no máximo 2 chamadas.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 25 [P com a 26]: PKCE do OpenRouter (D-10)

**Arquivos:** criar `lib/client/ai/pkce.ts` e `app/(local)/configuracoes/callback/page.tsx`; teste em `tests/unit/client/ai/pkce.test.ts`

**Interfaces:**
- `startOpenRouterAuth(callbackUrl: string): Promise<string>`. Gera o verifier, grava `sessionStorage['jobfind:pkce']` e devolve a URL `https://openrouter.ai/auth?callback_url=…&code_challenge=…&code_challenge_method=S256&limit=5&expiration=1-year`.
- `completeOpenRouterAuth(code: string): Promise<string>`. Faz `POST https://openrouter.ai/api/v1/auth/keys`, devolve a `key` e apaga o verifier.

- [ ] **Passo 1:** escrever o teste que falha.

```ts
const url = new URL(await startOpenRouterAuth('https://app/configuracoes/callback'))
expect(url.searchParams.get('code_challenge_method')).toBe('S256'); expect(url.searchParams.get('limit')).toBe('5')
expect(sessionStorage.getItem('jobfind:pkce')).toBeTruthy()
fetchMock.post('https://openrouter.ai/api/v1/auth/keys', { key: 'sk-or-x' })
expect(await completeOpenRouterAuth('c')).toBe('sk-or-x'); expect(sessionStorage.getItem('jobfind:pkce')).toBeNull()
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar. A página de callback salva a chave no `aiSettingsStore` (`source: 'pkce'`), limpa a URL com `history.replaceState` e redireciona para `/configuracoes`.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 26 [P com a 25]: Tela de Configurações de IA (US-03, RF-11)

**Arquivos:** criar `app/(local)/configuracoes/page.tsx` e `components/settings/{ProviderCard,AddKeyDialog,TaskModelRow,PrivacyConsentDialog,LocalAiGuide}.tsx`; teste em `tests/e2e/settings.spec.ts`

- [ ] **Passo 1:** escrever o E2E que falha. O OpenRouter, a OpenAI e o `/models` são mockados via `page.route`.
  - **Colar chave:** colar uma chave da OpenAI e clicar em "Testar conexão" mostra "Conectado". Com 401, mostra "Chave inválida".
  - **PKCE:** "Conectar" no OpenRouter navega para `openrouter.ai/auth`. O retorno simulado ao callback deixa o provedor conectado.
  - **Modelo por tarefa:** selecionar provedor e modelo para "Gerar CV e carta" persiste depois de recarregar a página.
  - **Aviso de privacidade:** escolher Gemini abre o diálogo, que precisa ser confirmado.
  - **Remover chave:** "Remover chave" apaga a chave do localStorage.
  - **Sem chave:** ir para Perfil sem provedor mostra o CTA para Configurações.
- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar seguindo a tela "Configurações de IA" do protótipo (cards, "Mais provedores", modelo por tarefa com custo estimado vindo de `listModels`, privacidade e backup). O backup só é ligado na Tarefa 37; até lá, os botões ficam desabilitados com o texto "em breve".
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 27 [P com as 23–24]: Extração de currículo no navegador (RF-12, SEC-09, D-12)

**Arquivos:** criar `lib/client/extract/index.ts` e `lib/client/extract/contact.ts`; testes em `tests/unit/client/extract.test.ts` e nas fixtures `tests/fixtures/cv/{texto.pdf,escaneado.pdf,colunas.pdf,cv.docx,zipbomb.docx,fake.pdf}`

**Interfaces:**
- `extractText(file: File): Promise<{ kind: 'pdf'|'docx'; text: string; pages: number; scanned: boolean }>`
- Lança `ExtractError` com `code`: `'too_large'|'bad_type'|'too_many_pages'|'timeout'|'empty'`
- `extractContact(text: string): { email: string|null; phone: string|null; links: string[] }`
- `redactContact(text: string): string`, que troca e-mail e telefone por `[EMAIL]` e `[TELEFONE]` (D-11, minimização)

- [ ] **Passo 1:** escrever o teste que falha.

```ts
await expect(extractText(fileOfSize(6 * 1024 * 1024))).rejects.toMatchObject({ code: 'too_large' })
await expect(extractText(fixture('fake.pdf'))).rejects.toMatchObject({ code: 'bad_type' })   // extensão .pdf, magic bytes errados
expect((await extractText(fixture('texto.pdf'))).scanned).toBe(false)
expect((await extractText(fixture('escaneado.pdf'))).scanned).toBe(true)
expect((await extractText(fixture('cv.docx'))).text).toContain('Experiência')
await expect(extractText(fixture('zipbomb.docx'))).rejects.toMatchObject({ code: expect.stringMatching(/timeout|too_large/) })
expect(redactContact('ana@x.com (11) 98888-7777')).toBe('[EMAIL] [TELEFONE]')
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar.
  - **Bibliotecas:** `unpdf` (ou o worker do `pdfjs-dist`, conforme a Tarefa 0.4) e `mammoth.extractRawText`, ambos com `import()`.
  - **Limites:** 10 páginas, 30.000 caracteres e 15 s.
  - **PDF escaneado:** pelas regras da D-12.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 28: Perfil — schema, prompt de extração e tela (US-04, RF-13, RF-14)

**Arquivos:**
- Criar: `lib/shared/schemas/profile.ts`, `lib/client/ai/prompts/profile.extract.v1.ts`, `lib/client/profile/import.ts`, `app/(local)/perfil/page.tsx` e `components/profile/{ImportPanel,ProfileEditor,SkillChips,ExperienceEditor}.tsx`
- Testes: `tests/unit/client/profile-import.test.ts` e `tests/e2e/profile.spec.ts`

**Interfaces:**
- `Profile` é o schema Zod do relatório de IA, `schemaVersion: 1`. Usa `.nullable()` em vez de `.optional()`, e as experiências levam `id` (`exp_N`) e bullets com `id` (`exp_N.bM`).
- `profileStore = createStore('jobfind:v1:profile', Profile.nullable(), …)`
- `PROFILE_EXTRACT_V1: PromptDef<{ cvText: string }, Profile>`. O tipo comum é `PromptDef<I, O> = { id: string; version: number; system: string; buildUser(i: I): string; schema: z.ZodType<O>; maxOutputTokens: number; temperature: number }`.
- `importProfile(text: string, settings: AiSettings, signal?: AbortSignal): Promise<Profile>`. Aplica `redactContact` antes de enviar ao modelo e depois preenche o `contact` com `extractContact` local. Depois do retorno, preenche `skills[].stackId` com `normalizeSkill`.

- [ ] **Passo 1:** escrever o teste unitário que falha, com a IA mockada.
  - O prompt enviado não contém o e-mail nem o telefone do currículo.
  - O perfil devolvido tem `contact.email` preenchido localmente.
  - `stackId` vem normalizado.
  - Os ids `exp_N` são únicos.
- [ ] **Passo 2:** escrever o E2E que falha.
  - O upload de `texto.pdf` mostra o editor preenchido.
  - O upload de `escaneado.pdf` mostra "Não consegui ler o texto deste PDF; cole o texto do currículo", com o campo de texto aberto.
  - Uma importação com perfil existente pede confirmação de substituição.
  - Uma edição salva sobrevive ao reload.
- [ ] **Passo 3:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 4:** implementar seguindo a tela "Perfil" do protótipo.
- [ ] **Passo 5:** rodar os testes. Esperado: PASS.
- [ ] **Passo 6:** commitar.

### Task 29 [P com a 30]: Score local e filtro de chance (RF-15, RN-06, D-13)

**Arquivos:** criar `lib/client/score/score.ts` e `lib/client/jobs/use-jobs-with-chance.ts`; modificar `components/jobs/{JobCard,ChanceBadge,FiltersPanel}.tsx` e `components/jobs/JobDetail.tsx`; teste em `tests/unit/client/score.test.ts`

**Interfaces:**
- `indexProfile(p: Profile): ProfileIndex`
- `scoreJob(pi: ProfileIndex, job: JobSummary, now: Date): { score: number; band: 'alta'|'media'|'baixa'; breakdown: { criterion: 'stack'|'seniority'|'language'|'location'|'recency'; weight: number; value: number; available: boolean; reason: string }[] }`
- `useJobsWithChance(filters, bands: ('alta'|'media'|'baixa')[] | null)`: quando `bands` está definido, pede `limit=90` e busca mais páginas até reunir 30 itens ou chegar a 5 requisições.

- [ ] **Passo 1:** escrever o teste que falha.

```ts
// pesos: stack 45, senioridade 20, idioma 15, local 15, recência 5; redistribui o peso quando falta dado
expect(scoreJob(pi(['react','nextjs','typescript'], 'senior', 'advanced'), job({ stacks: ['react','nextjs','typescript','graphql'], seniority: 'senior', language: 'pt', workMode: 'remote', acceptsBrazil: true, age: '2h' }), now).band).toBe('alta')
expect(scoreJob(piSemIngles, job({ language: 'en' }), now).breakdown.find(b => b.criterion === 'language')!.value).toBe(0)
expect(scoreJob(pi(...), job({ seniority: null }), now).breakdown.find(b => b.criterion === 'seniority')!.available).toBe(false)
// faixas: 70 → alta; 69 → media; 40 → media; 39 → baixa
// stack no título vale 2x; git/sql valem 0,5x; typescript↔javascript dá 0,5 de crédito
// recência: ≤ 3 dias = 100, decai linearmente até 0 em 30 dias
// 30 vagas pontuadas em < 5 ms
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar e ligar na interface. O card mostra o selo, o detalhe mostra "Sua chance" com o breakdown, e o painel de filtros ganha o filtro de chance.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 30 [P com a 29]: Análise com IA (RF-16, US-05)

**Arquivos:** criar `lib/shared/schemas/fit.ts`, `lib/client/ai/prompts/job.fit.v1.ts` e `lib/client/jobs/analyze.ts`; modificar `components/jobs/JobDetail.tsx`; testes em `tests/unit/client/analyze.test.ts` e `tests/e2e/analysis.spec.ts`

**Interfaces:**
- `FitAnalysis` (zod, do relatório de IA)
- `JOB_FIT_V1: PromptDef<{ profile: Profile; job: JobDetail; local: ReturnType<typeof scoreJob> }, FitAnalysis>`, com a vaga dentro de `wrapUntrusted('job_description', text, 12000)`
- `analyzeJob(...)`: grava `{ ...FitAnalysis, provider, model, promptVersion, createdAt }` em `jobfind:v1:aiAnalysis[jobId]`
- A nota revisada é limitada ao intervalo 0–100.

- [ ] **Passo 1:** escrever os testes que falham.
  - O prompt não leva e-mail, telefone nem endereço.
  - O resultado é salvo e reaparece sem nova chamada.
  - No E2E, "Analisar com IA" mostra pontos fortes, lacunas e palavras-chave, além do rodapé "Gerada com <modelo> via <provedor>".
  - Um erro 402 mostra "Sem crédito, recarregue" com o botão "Tentar de novo".
- [ ] **Passo 2:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar os testes. Esperado: PASS.
- [ ] **Passo 5:** commitar.

**Portão da Fase 2:** US-03, US-04 e US-05 verdes no E2E, e `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm test:e2e` sem falhas.

---

## Fase 3: CV e carta

### Task 31: Schema e prompt de geração, e montagem do CV (RF-17, RN-07 camada 1, RN-08)

**Arquivos:** criar `lib/shared/schemas/tailored.ts`, `lib/client/ai/prompts/cv.tailor.v1.ts` e `lib/client/cv/assemble.ts`; teste em `tests/unit/client/cv-assemble.test.ts`

**Interfaces:**
- `TailoredDocs` (zod, do relatório de IA). Cada experiência tem só `expId` e bullets com `sourceBulletIds`. A carta é `nullable`.
- `CV_TAILOR_V1: PromptDef<{ profile: Profile; job: JobDetail; lang: 'pt'|'en'|'es'; withCoverLetter: boolean }, TailoredDocs>`
  - `maxOutputTokens: 8000`
  - `temperature: 0.5`
- `pickLanguage(job: JobDetail): 'pt'|'en'|'es'`: `unknown` vira `'pt'`.
- `assembleCv(profile: Profile, docs: TailoredDocs): AssembledCv`. Empresa, cargo, datas, formação e contato vêm só do perfil.
- `AssembledCv = { name; contactLine; headline; summary; skills: string[]; experiences: { company; role; period; bullets: { text; flagged: boolean }[] }[]; education: string[]; certifications: string[]; lang }`

- [ ] **Passo 1:** escrever o teste que falha.

```ts
const cv = assembleCv(profile, docs)
expect(cv.experiences[0].company).toBe(profile.experiences.find(e => e.id === docs.cv.experiences[0].expId)!.company)
expect(() => assembleCv(profile, withExpId(docs, 'exp_99'))).toThrow(/expId desconhecido/)
expect(pickLanguage(job({ language: 'en' }))).toBe('en'); expect(pickLanguage(job({ language: 'unknown' }))).toBe('pt')
expect(CV_TAILOR_V1.buildUser(input)).not.toContain(profile.contact.email!)
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 32: Validador anti-alucinação (RN-07 camadas 2 e 3)

**Arquivos:** criar `lib/client/cv/validate.ts`; teste em `tests/unit/client/cv-validate.test.ts`

**Interfaces:**
- `validateTailored(profile: Profile, docs: TailoredDocs): Violation[]`
- `Violation = { kind: 'unknown_exp'|'unknown_skill'|'unknown_stack'|'unknown_year'|'unknown_number'|'unknown_name'; text: string; where: { expId?: string; bulletIndex?: number; part: 'cv'|'letter' } }`
- `toPromptFeedback(v: Violation[]): string[]` alimenta o `validate` da Tarefa 24.

- [ ] **Passo 1:** escrever o teste que falha.

```ts
expect(validateTailored(profile, clean)).toEqual([])
expect(kinds(validateTailored(profile, withSkill('Kubernetes')))).toContain('unknown_skill')
expect(kinds(validateTailored(profile, withBullet('exp_1', 'Reduzi 40% do LCP', ['exp_1.b3'])))).toContain('unknown_number')
expect(kinds(validateTailored(profile, withBullet('exp_1', 'Usei React.js e Next', ['exp_1.b2'])))).toEqual([])   // normaliza sinônimos
expect(kinds(validateTailored(profile, withBullet('exp_1', 'Trabalhei na Google em 2015', ['exp_1.b1'])))).toEqual(expect.arrayContaining(['unknown_name', 'unknown_year']))
expect(kinds(validateTailored(profile, withLetterParagraph('Tenho 10 anos de AWS')))).toContain('unknown_stack')   // a carta também é validada
expect(validateTailored(profile, withBullet('exp_1', '1.000 usuários', ['exp_1.b4' /* fonte com "1k usuários" */]))).toEqual([])
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar.
  - **Números:** normalizar (`1.000`, `1k` e `1000` são equivalentes) antes de comparar com o `sourceText` dos bullets de origem.
  - **Nomes próprios:** só palavras com inicial maiúscula fora do início de frase e fora do perfil e da vaga geram alerta.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 33 [P com a 32]: PDF do CV e da carta (RF-18, D-14)

**Arquivos:** criar `lib/client/pdf/{CvDocument,CoverLetterDocument}.tsx`, `lib/client/pdf/fonts.ts`, `lib/client/pdf/filename.ts`, `lib/client/pdf/render.ts` e `public/fonts/Inter-{Regular,Bold}.ttf`; teste em `tests/unit/client/pdf.test.ts` (node)

**Interfaces:**
- `renderCvPdf(cv: AssembledCv): Promise<{ blob: Blob; pages: number }>`
- `renderLetterPdf(letter: NonNullable<TailoredDocs['coverLetter']>, cv: AssembledCv): Promise<{ blob: Blob; pages: number }>`
- `cvFileName(name: string, company: string, role: string): string` gera `CV-<Nome>-<Empresa>-<cargo>.pdf`, sem acento, com espaços virando `-` e até 120 caracteres.
- Os bullets com `flagged: true` não entram no PDF.

- [ ] **Passo 1:** escrever o teste que falha.

```ts
const { blob, pages } = await renderCvPdf(cvFixture)
const text = (await extractText(new Uint8Array(await blob.arrayBuffer()), { mergePages: true })).text   // unpdf: round-trip ATS
expect(text).toContain('Experiência'); expect(text).toContain('São Paulo'); expect(pages).toBeLessThanOrEqual(2)
expect(text).not.toContain(flaggedBulletText)
expect(cvFileName('Ana Souza', 'Lumen Pay', 'Frontend Sênior')).toBe('CV-Ana-Souza-Lumen-Pay-Frontend-Senior.pdf')
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar um template ATS de coluna única, igual à pré-visualização da tela "Gerador". Cabeçalhos de seção no idioma do CV: Resumo/Summary/Resumen e equivalentes.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 34: Tela do Gerador (US-06)

**Arquivos:** criar `app/(local)/gerador/[jobId]/page.tsx`, `components/generator/{GeneratorToolbar,TailoredEditor,ReviewBanner,PdfPreview,GapsPanel}.tsx` e `lib/client/cv/generate.ts`; teste em `tests/e2e/generator.spec.ts`

**Interfaces:**
- `generateDocs(...)` chama `generateStructured` com `CV_TAILOR_V1` e `validate: v => toPromptFeedback(validateTailored(profile, v))`. Persiste `{ ...TailoredDocs, provider, model, promptVersion, createdAt, edits, approvedFlags: string[] }` em `jobfind:v1:generatedDocs[jobId]`.

- [ ] **Passo 1:** escrever o E2E que falha, com a IA mockada.
  - "Gerar" mostra o CV no idioma da vaga em até 60 s, com streaming parcial visível.
  - Um bullet com número inventado aparece destacado, com o banner "1 trecho precisa da sua revisão", e fica fora do PDF. "Aprovar mesmo assim" inclui o trecho.
  - "Baixar PDF" baixa um arquivo com o nome padrão.
  - Trocar o idioma para EN refaz a geração em inglês.
  - Marcar "Incluir carta" gera a carta, que fica disponível na aba "Carta de apresentação".
  - Um 429 mostra "Tentar de novo" e as edições feitas continuam lá.
  - O aviso aparece quando o CV passa de 2 páginas.
- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar seguindo a tela "Gerador de CV e carta" do protótipo. A pré-visualização usa `renderCvPdf` com debounce de 500 ms num iframe `blob:`.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 35: Avaliação da IA com 10 pares

**Arquivos:** criar `scripts/eval-ai.ts` e `tests/fixtures/ai/pairs/{01..10}.json` (perfil e vaga, sem dados reais)

- [ ] **Passo 1:** escrever o script. Ele roda `CV_TAILOR_V1` com a chave do executor e imprime uma tabela com: violações do validador, JSON válido (sim/não), tempo e custo de cada par.
- [ ] **Passo 2:** rodar `pnpm tsx scripts/eval-ai.ts --provider openrouter`. **Esperado:** zero violações persistentes nos 10 pares; p95 do tempo até 60 s.
- [ ] **Passo 3:** registrar o resultado em `docs/tech/spikes.md`, na seção "Avaliação v1".
- [ ] **Passo 4:** commitar.

**Portão da Fase 3:** a US-06 verde e a avaliação sem fatos inventados.

---

## Fase 4: Organização, robustez e mais fontes

As tarefas desta fase são independentes entre si. A 36 e a 37 dependem da 21 (store); as demais dependem da Fase 1.

### Task 36 [P]: Favoritos, ocultar, status e Minhas vagas (US-07, RF-19)

**Arquivos:** criar `lib/client/jobs/job-state.ts`, `app/(local)/minhas-vagas/page.tsx` e `components/my-jobs/{Board,Column,JobMiniCard}.tsx`; modificar `components/jobs/JobCard.tsx` e `JobDetail.tsx`; testes em `tests/unit/client/job-state.test.ts` e `tests/e2e/my-jobs.spec.ts`

**Interfaces:**
- `JobStatus = 'none'|'saved'|'applied'|'interview'|'offer'|'rejected'`
- `JobState = { favorite: boolean; hidden: boolean; status: JobStatus; statusHistory: { status: JobStatus; at: string }[]; snapshot: Pick<JobSummary, 'id'|'title'|'company'|'url_canonical'|'stacks'|'work_mode'|'published_at'> }`
- `setFavorite(job, v)`, `setHidden(job, v)` e `setStatus(job, s)` gravam o `snapshot` na primeira interação.
- `useJobsFilters` ganha `showHidden`. Fora desse filtro, vagas ocultas somem da lista.

- [ ] **Passo 1:** escrever os testes que falham.
  - Qualquer transição de status é aceita, inclusive a volta para `none`.
  - `statusHistory` registra a data.
  - Uma vaga favoritada que saiu do índice (404 na API) ainda aparece em Minhas vagas, a partir do snapshot.
  - Uma vaga oculta some da home, e "Mostrar vagas ocultas" traz de volta.
- [ ] **Passo 2:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 3:** implementar seguindo a tela "Minhas vagas" do protótipo.
- [ ] **Passo 4:** rodar os testes. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 37 [P]: Backup — exportar e importar (US-08, RF-20, SEC-10, SEC-11)

**Arquivos:** criar `lib/client/storage/backup.ts`; modificar a seção de backup de `app/(local)/configuracoes/page.tsx`; teste em `tests/unit/client/backup.test.ts`

**Interfaces:**
- `exportBackup(opts: { includeKeys: boolean }): Blob`, com o arquivo `jobfind-backup-AAAA-MM-DD.json` e `{ format: 'jobfind-backup', v: 1, exportedAt, data: Record<StorageKey, unknown> }`
- `parseBackup(file: File): Promise<{ ok: true; backup: Backup; hasKeys: boolean; keyHints: Record<ProviderId, string> } | { ok: false; reason: 'too_large'|'invalid' }>`
- `applyBackup(b: Backup, opts: { acceptKeys: boolean }): void`

- [ ] **Passo 1:** escrever o teste que falha.

```ts
expect(JSON.parse(await exportBackup({ includeKeys: false }).text()).data['jobfind:v1:ai'].providers.openai.key).toBeUndefined()
expect((await parseBackup(fileOfSize(6e6))).ok).toBe(false)
const r = await parseBackup(jsonFile({ format: 'jobfind-backup', v: 1, data: { '__proto__': { polluted: true } } }))
expect(({} as any).polluted).toBeUndefined()
applyBackup(withKey('sk-attacker-1234'), { acceptKeys: false }); expect(currentKey('openai')).toBe(originalKey)
expect((await parseBackup(withKeyFile)).keyHints.openai).toBe('1234')      // mostra só os 4 últimos caracteres
// snapshots com <img onerror> são ressanitizados na importação
```

- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar.
  - **Validação:** Zod `.strict()` por chave, sem deep merge.
  - **Exportação:** a interface avisa que o arquivo contém dados pessoais.
  - **Importação de chaves:** pede confirmação mostrando os 4 últimos caracteres da chave.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 38 [P]: Conectores GitHub, We Work Remotely, RemoteOK e HN

Seguem o mesmo molde das Tarefas 11 a 14. Cada conector tem asserções próprias:

- **GitHub:** usa `GITHUB_TOKEN` no header e é `fullSnapshot` (só issues abertas).
  - **Repositórios:** a lista fica em `GITHUB_REPOS` (frontendbr/vagas, backend-br/vagas, react-brasil/vagas, qa-brasil/vagas, androiddevbr/vagas).
  - **Local e formato:** o título `[Remoto] …` gera `workModeHint: 'remote'`; as labels viram `seniorityHint`; usa `descriptionFormat: 'markdown'`; é `brazilian: true`.
  - **Issue fechada:** some da lista e expira em 3 coletas.
- **We Work Remotely:** lê o RSS das categorias tech; `region` vira `eligibleRegions`.
- **RemoteOK:** ignora o item [0] e usa atribuição `dofollow: true` (o teste confere que o link não tem `nofollow`). Não exibe o logo deles.
- **HN:** acha a thread do mês via Algolia (`author_whoishiring`). O parser heurístico "Empresa | Cargo | Local | Remote | Salário" descarta comentários que não seguem o formato.
  - **Precisão:** pelo menos 80% dos comentários da fixture parseados corretamente.

Depois dos conectores, incluir cada fonte no `docs/fontes.md` e commitar cada uma separadamente.

### Task 39 [P]: Status das fontes, página Fontes e Privacidade (RF-21, LGPD)

**Arquivos:** criar `app/api/sources/status/route.ts`, `app/(site)/fontes/page.tsx` e `app/(site)/privacidade/page.tsx`; testes em `tests/integration/api/sources-status.test.ts` e `tests/e2e/sources.spec.ts`

- [ ] **Passo 1:** escrever os testes que falham.
  - A rota devolve, para cada fonte, `status: 'ok'|'failing'` (falhando a partir de 3 falhas seguidas), `lastSuccessAt` e `lastRun`, com cache de 5 min na CDN.
  - A página mostra o aviso "Coleta parada há mais de 3 h" quando aplicável.
  - A página de Privacidade contém as seções exigidas pela spec (5.4, linha LGPD): onde ficam os dados; envio ao provedor de IA escolhido; transferência internacional (OpenRouter nos EUA, DeepSeek na China, Gemini gratuito usado para treino); logs de IP da Vercel; analytics; como apagar tudo; canal para pedir remoção de dados de terceiros que aparecem em vagas, com o placeholder `[EMAIL DE CONTATO]` até a Q-05 ser respondida.
- [ ] **Passo 2:** rodar os testes. Esperado: FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar os testes. Esperado: PASS.
- [ ] **Passo 5:** commitar.

### Task 40 [P]: Testes de contrato agendados e validação de slugs

**Arquivos:** criar `.github/workflows/contracts.yml` e `tests/contract/sources.contract.test.ts` (fora dos projetos `unit` e `integration`; roda com `vitest run tests/contract`)

- [ ] **Passo 1:** escrever o teste. Para cada conector, chama a API real uma vez e valida o payload com o mesmo schema Zod do conector. Para Greenhouse, Lever e Ashby, testa cada slug: 404 ou zero vagas gera falha nomeando o slug.
- [ ] **Passo 2:** criar o workflow diário (`cron: '41 6 * * *'`), com `permissions: {}`. O `GITHUB_TOKEN` e o `HIMALAYAS_API_KEY` vêm de secrets do GitHub.
- [ ] **Passo 3:** rodar localmente com `pnpm vitest run tests/contract`. Esperado: PASS, ou falha listando o slug ou a fonte quebrada.
- [ ] **Passo 4:** commitar.

### Task 41 [P]: Filtros salvos, selo "Nova" e salário (RF-22, RF-23)

**Arquivos:** modificar `components/jobs/{JobsPage,JobCard,FiltersPanel}.tsx` e `lib/client/jobs/use-jobs.ts`; teste em `tests/e2e/home-extras.spec.ts`

- [ ] **Passo 1:** escrever o E2E que falha.
  - "Salvar como busca padrão" persiste os filtros, que são aplicados ao abrir a home sem parâmetros na URL.
  - O selo "Nova" aparece só em vagas com `published_at` posterior a `jobfind:v1:lastVisit`, que é atualizado ao sair da página.
  - O salário aparece no formato `R$ 14.000 – 18.000 / mês` quando existe e some quando não existe.
- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5:** commitar.

**Portão da Fase 4:**
- US-07 e US-08 verdes;
- 10 ou mais fontes ativas;
- 3.000 ou mais vagas ativas, das quais 800 ou mais nacionais (medido em produção depois de 7 dias);
- todos os comandos de verificação verdes.

---

## Rastreabilidade (requisito → tarefa)

| Requisito | Tarefas | Requisito | Tarefas |
|---|---|---|---|
| RF-01 | 15, 16 | RF-15 | 29 |
| RF-02/03 | 4, 7 | RF-16 | 30 |
| RF-04 | 3 | RF-17 | 31, 32, 34 |
| RF-05/06 | 4 | RF-18 | 33 |
| RF-07 | 7, 15 | RF-19 | 36 |
| RF-08/09/10 | 8, 9, 18 | RF-20 | 37 |
| RF-11 | 23–26 | RF-21 | 39 |
| RF-12 | 27 | RF-22/23 | 41 |
| RF-13/14 | 28 | RF-24 | 1 |
| RN-07 | 31, 32, 34, 35 | SEC-01/07 | 17 |
| SEC-02 | 5, 19, 37 | SEC-03 | 2 |
| SEC-04 | 16 | SEC-05 | 8, 9, 20 |
| SEC-06 | 10 | SEC-08 | 1 |
| SEC-09 | 27 | SEC-10/11 | 37 |
| SEC-12 | 24, 28, 30, 31 | RNF-10 | 21, 22 |
