# Limpeza de vagas e coleta do LinkedIn: plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** uma CRON diária que apaga vagas com mais de 60 dias, vagas expiradas há mais de 30 dias e `source_runs` com mais de 30 dias; e a coleta do LinkedIn rodando a cada 2 h dentro dos US$ 5/mês do Apify, sem perder datasets.

**Arquitetura:** a retenção sai de `runCollection` e vira `purgeOld` em `lib/server/jobs/expire.ts`, chamada por uma rota nova `/api/cron/purge` com agendamento próprio no `vercel.json`. A autenticação do cron é extraída para `lib/server/cron-auth.ts` e usada pelas duas rotas. O conector `lib/server/sources/linkedin.ts` muda constantes, tolera falha no início da execução e ingere todas as execuções novas.

**Stack:** Next.js 16 (route handlers), Drizzle ORM sobre Postgres (Neon), Vitest (unit + integração com Postgres no Docker), Vercel Schedules.

**Spec:** [docs/tech/2026-11-25-auditoria-insercao-e-limpeza-de-vagas.md](../tech/2026-11-25-auditoria-insercao-e-limpeza-de-vagas.md)

## Restrições globais

- Nenhuma variável de ambiente ou feature flag nova. A rota de limpeza usa o `CRON_SECRET` que já existe.
- Textos, comentários e mensagens em pt-BR; identificadores em inglês, no padrão do projeto.
- Regras de exclusão: `published_at < now - 60 dias` (qualquer estado); `expired_at < now - 30 dias`; `source_runs.started_at < now - 30 dias`. Lotes de 2000; parar ao passar de 50 s.
- Agendamento da limpeza: `"37 4 * * *"` (UTC), GET, `/api/cron/purge`.
- LinkedIn: `RUN_EVERY_HOURS = 2`, `RESULTS_PER_RUN = 32`, `MAX_CHARGE_PER_RUN_USD = 0.013`. `datePosted` segue `"r86400"`.
- Não commitar sem pedido explícito do Jaymes. Executar numa branch própria criada a partir da `main` (a branch atual, `feat/redesign-ux-mobile`, é de outro trabalho): confirmar o nome antes de começar.
- Verificação ao fim de cada fase: `pnpm typecheck && pnpm lint && pnpm test`, `pnpm db:test:up && pnpm test:integration`, e `pnpm build` na fase 1 (rota nova e `vercel.json`).

## Foco de revisão

1. **Vaga ativa nunca é apagada pela limpeza:** uma vaga ativa com `published_at` de 59 dias (não deveria existir, mas se a expiração falhar) segue no banco. Coberto na Tarefa 1.
2. **Primeira execução em produção com muito acumulado:** o laço em lotes termina e respeita o prazo, devolvendo o que apagou. Coberto na Tarefa 1 (lotes e prazo).
3. **Falha do banco na limpeza:** a rota responde 500 com `no-store`, registra o erro e fecha o pool. Coberto na Tarefa 3.
4. **Crédito do Apify esgotado no fim do mês:** o POST de início falha com HTTP 402; as vagas do dataset já pronto são gravadas e o cursor avança. Coberto na Tarefa 6.
5. **Coleta perdida entre duas execuções do actor:** os dois datasets entram, do mais antigo para o mais novo, e nenhum é reingerido depois. Coberto na Tarefa 7.

---

## Fase 1: CRON de limpeza

### Task 1: `purgeOld` em lotes

**Arquivos:**
- Modificar: `lib/server/jobs/expire.ts:366-367` (constantes) e `:448-456` (substituir `purgeExpired`)
- Teste: `tests/integration/jobs/expire.test.ts:98-111` (substituir o `describe("purgeExpired")`)

**Interfaces:**
- Produz:
  - `export const MAX_STORED_AGE_DAYS = 60`, `export const RETENTION_DAYS = 30` (já existe), `export const SOURCE_RUNS_RETENTION_DAYS = 30`, `export const PURGE_BATCH_SIZE = 2000`, `export const PURGE_TIME_LIMIT_MS = 50_000`.
  - `export type PurgeResult = { jobs: number; sourceRuns: number }`.
  - `export async function purgeOld(db: Db, now: Date, opts?: { batchSize?: number; clock?: () => number; timeLimitMs?: number }): Promise<PurgeResult>`.
  - `purgeExpired` deixa de existir.

- [ ] **Passo 1: escrever os testes que falham**

No lugar do `describe("purgeExpired")`, um `describe("purgeOld")` com `beforeEach(resetDb)` e (importar `sourceRuns` de `@/lib/server/db/schema`):

```ts
it("apaga vaga publicada há mais de 60 dias, ativa ou não, e preserva a de 59", async () => {
  const db = await testDb();
  const old = await insertJobRaw(db, { published_at: addDays(T0, -61) });
  const keep = await insertJobRaw(db, { published_at: addDays(T0, -59) });
  await addSource(db, old.id, "greenhouse", "x", T0);
  expect(await purgeOld(db, T0)).toEqual({ jobs: 1, sourceRuns: 0 });
  expect((await db.select({ id: jobs.id }).from(jobs)).map((r) => Number(r.id))).toEqual([Number(keep.id)]);
  expect(await db.select().from(jobSources).where(eq(jobSources.externalId, "x"))).toHaveLength(0);
});

it("apaga expirada há mais de 30 dias e preserva a expirada há 29", async () => {
  const db = await testDb();
  await insertJobRaw(db, { published_at: addDays(T0, -50), expired_at: addDays(T0, -31) });
  const recent = await insertJobRaw(db, { published_at: addDays(T0, -50), expired_at: addDays(T0, -29) });
  expect((await purgeOld(db, T0)).jobs).toBe(1);
  expect((await db.select({ id: jobs.id }).from(jobs)).map((r) => Number(r.id))).toEqual([Number(recent.id)]);
});

it("apaga source_runs com mais de 30 dias, inclusive presas em running", async () => {
  const db = await testDb();
  await db.insert(sourceRuns).values([
    { source: "greenhouse", startedAt: addDays(T0, -31), status: "running" },
    { source: "greenhouse", startedAt: addDays(T0, -31), status: "ok" },
    { source: "greenhouse", startedAt: addDays(T0, -29), status: "ok" },
  ]);
  expect(await purgeOld(db, T0)).toEqual({ jobs: 0, sourceRuns: 2 });
  expect(await db.select().from(sourceRuns)).toHaveLength(1);
});

it("apaga em lotes até acabar", async () => {
  const db = await testDb();
  for (let i = 0; i < 5; i++) await insertJobRaw(db, { published_at: addDays(T0, -70) });
  expect((await purgeOld(db, T0, { batchSize: 2 })).jobs).toBe(5);
  expect(await db.select().from(jobs)).toHaveLength(0);
});

it("para no prazo e devolve o que já apagou", async () => {
  const db = await testDb();
  for (let i = 0; i < 5; i++) await insertJobRaw(db, { published_at: addDays(T0, -70) });
  let t = 0;
  const clock = () => (t += 1000); // cada leitura avança 1 s
  const r = await purgeOld(db, T0, { batchSize: 2, clock, timeLimitMs: 1500 });
  expect(r.jobs).toBe(2);
  expect(await db.select().from(jobs)).toHaveLength(3);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `pnpm db:test:up && pnpm vitest run --project integration tests/integration/jobs/expire.test.ts`
Esperado: FAIL, `purgeOld` não é exportado.

- [ ] **Passo 3: implementar `purgeOld` e remover `purgeExpired`**

Laço por tabela: `db.delete(t).where(inArray(t.id, db.select({ id: t.id }).from(t).where(<regra>).limit(batchSize))).returning({ id: t.id })`, somando `rows.length`, até `rows.length < batchSize` ou `clock() - start > timeLimitMs` (lido antes de cada lote, a partir do segundo). Regra de `jobs`: `or(lt(jobs.publishedAt, cutoff60), and(isNotNull(jobs.expiredAt), lt(jobs.expiredAt, cutoff30)))`. `jobs` primeiro, `source_runs` depois, com o mesmo prazo total. Atualizar o comentário das constantes (D-02 da spec).

- [ ] **Passo 4: rodar e ver passar**

Run: o mesmo do passo 2. Esperado: PASS.

### Task 2: tirar a retenção da coleta

**Arquivos:**
- Modificar: `lib/server/collect/run.ts:486` (import), `:518-519` (`PURGE_HOUR_UTC`), `:933`
- Teste: `tests/integration/collect/run.test.ts:619-643`

**Interfaces:**
- Consome: nada da Tarefa 1 além da remoção de `purgeExpired` (este import precisa sair).

- [ ] **Passo 1: ajustar o teste para o comportamento novo**

Renomear para `"expira vagas ao final e não apaga nada, nem às 03h UTC (a retenção é da rota de limpeza)"`. Remover o spy. Depois da execução das `2026-06-02T03:17:00.000Z`, a vaga `old` continua no banco:

```ts
expect(await db.select().from(jobs).where(eq(jobs.id, old.id))).toHaveLength(1);
```

Manter as asserções de expiração da vaga `fresh` e de `invalidate("jobs")` na primeira execução.

- [ ] **Passo 2: rodar e ver falhar**

Run: `pnpm vitest run --project integration tests/integration/collect/run.test.ts -t "não apaga nada"`
Esperado: FAIL (a coleta das 03h ainda apaga), ou erro de import se a Tarefa 1 já removeu `purgeExpired`.

- [ ] **Passo 3: remover a chamada, a constante e o import**

O `try` passa a ter só `expireJobs`; a mensagem do `console.error` vira `falha na expiração`.

- [ ] **Passo 4: rodar o arquivo inteiro e ver passar**

Run: `pnpm vitest run --project integration tests/integration/collect/run.test.ts`
Esperado: PASS.

### Task 3: rota `/api/cron/purge`, autenticação compartilhada e agendamento

**Arquivos:**
- Modificar: `lib/server/cron-auth.ts` (nova função), `app/api/cron/collect/route.ts:37-48` (usar a função), `vercel.json`
- Criar: `app/api/cron/purge/route.ts`
- Teste: criar `tests/unit/server/cron-purge-route.test.ts`; `tests/unit/server/cron-route.test.ts` e `tests/unit/server/cron-auth.test.ts` devem seguir passando sem mudança

**Interfaces:**
- Consome: `purgeOld(db, now): Promise<PurgeResult>` (Tarefa 1); `getPoolDb()` de `@/lib/server/db/client`.
- Produz: `export function rejectCronRequest(req: Request, label: string): Response | null` em `lib/server/cron-auth.ts`. Devolve a resposta 401 (`{ error: { code: "unauthorized", message: "Não autorizado." } }`, `Cache-Control: no-store`) quando falta `CRON_SECRET` ou o header não confere, e `null` quando autorizado. Sem `CRON_SECRET`, registra `[<label>] CRON_SECRET não está definida: todas as chamadas serão recusadas.` uma vez por label.

- [ ] **Passo 1: escrever o teste da rota que falha**

No molde de `cron-route.test.ts`: `vi.mock("@/lib/server/jobs/expire", () => ({ purgeOld: m.purgeOld }))` e `vi.mock("@/lib/server/db/client", () => ({ getPoolDb: m.getPoolDb }))`, com `CRON_SECRET=s3cr3t`.

```ts
it("expõe maxDuration 60 e GET/POST", () => {
  expect(maxDuration).toBe(60);
  expect(POST).toBe(GET);
});
it("401 sem header ou com segredo errado, sem tocar no banco", async () => {
  expect((await GET(req())).status).toBe(401);
  expect((await GET(req("Bearer errado"))).status).toBe(401);
  expect(m.getPoolDb).not.toHaveBeenCalled();
});
it("200 com as contagens e fecha o pool", async () => {
  m.purgeOld.mockResolvedValue({ jobs: 3, sourceRuns: 7 });
  const res = await GET(req("Bearer s3cr3t"));
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ jobs: 3, sourceRuns: 7 });
  expect(m.end).toHaveBeenCalledTimes(1);
});
it("500 quando a limpeza falha, registra o erro e fecha o pool", async () => {
  m.purgeOld.mockRejectedValue(new Error("boom"));
  const res = await GET(req("Bearer s3cr3t"));
  expect(res.status).toBe(500);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(console.error).toHaveBeenCalled();
  expect(m.end).toHaveBeenCalledTimes(1);
});
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `pnpm vitest run tests/unit/server/cron-purge-route.test.ts`
Esperado: FAIL, módulo `@/app/api/cron/purge/route` não existe.

- [ ] **Passo 3: implementar**

- `rejectCronRequest` em `cron-auth.ts`, usando `verifyCronSecret`.
- `app/api/cron/collect/route.ts` passa a usar `rejectCronRequest(req, "cron/collect")` no lugar do bloco local (remover `warnedMissingSecret`).
- `app/api/cron/purge/route.ts`: `dynamic = "force-dynamic"`, `maxDuration = 60`, `export { handler as GET, handler as POST }`. Síncrono (sem `after`): `getPoolDb()`, `purgeOld(db, new Date())`, `console.log("[cron/purge] jobs=<n> sourceRuns=<n>")`, 200 com o resultado; erro → `console.error` + 500 `{ error: { code: "internal", message: "Falha na limpeza." } }`; `db.$client.end()` no `finally`.
- `vercel.json`: em `schedules`, `"purge": { "schedule": "37 4 * * *", "path": "/api/cron/purge", "requestMethod": "GET" }`.

- [ ] **Passo 4: rodar e ver passar**

Run: `pnpm vitest run tests/unit/server/cron-purge-route.test.ts tests/unit/server/cron-route.test.ts tests/unit/server/cron-auth.test.ts`
Esperado: PASS.

- [ ] **Passo 5: verificação da fase**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration && pnpm build`
Esperado: tudo verde; o build lista a rota `/api/cron/purge`.

## Fase 2: Diagnóstico e documentação

### Task 4: consultas versionadas e docs da retenção

**Arquivos:**
- Criar: `scripts/db-audit.sql` (seções 5 e 9.1 da spec, só SELECT, com um comentário por consulta dizendo o que esperar)
- Modificar: `docs/tech/2026-11-23-job-find-agregador-vagas-tech.md` (D-04, item **Retenção**: rota diária `/api/cron/purge` às 04:37 UTC, regras R-1 a R-3, link para a spec nova); `README.md`/`CONTRIBUTING.md` só se citarem a retenção (`grep -n "retenção\|03:17" README.md CONTRIBUTING.md`)

- [ ] **Passo 1: criar `scripts/db-audit.sql` e ajustar os docs**
- [ ] **Passo 2: conferir que o SQL é só leitura**

Run: `grep -inE '\b(delete|update|insert|drop|alter|truncate)\b' scripts/db-audit.sql`
Esperado: nenhuma linha.

- [ ] **Passo 3 (manual, do Jaymes):** rodar `scripts/db-audit.sql` no Neon antes do deploy e 7 dias depois; anotar os números na spec.

## Fase 3: LinkedIn (independente das fases 1 e 2)

### Task 5: cadência de 2 h e orçamento

**Arquivos:**
- Modificar: `lib/server/sources/linkedin.ts:8-27` (comentários e constantes), `docs/fontes.md:32` (linha do LinkedIn: 2 h, 32 vagas, US$ 0,013 por execução, ~US$ 4,84/mês, rodízio a cada 16 h por palavra), `.env.example:13-14` só se o texto citar 12 h
- Modificar: `tests/fixtures/sources/linkedin/runs.json` (`runNew.startedAt = "2026-11-23T11:00:00.000Z"`, `runOld.startedAt = "2026-11-23T09:00:00.000Z"`: com `now` = 12:00, a última começou há 1 h)
- Teste: `tests/unit/server/sources/linkedin.test.ts`

**Interfaces:**
- Produz: `RUN_EVERY_HOURS = 2`, `RESULTS_PER_RUN = 32`, `MAX_CHARGE_PER_RUN_USD = 0.013` (nomes inalterados).

- [ ] **Passo 1: escrever/ajustar os testes**

```ts
it("orçamento cabe nos US$ 5 com execução a cada 2 h", () => {
  expect(RUN_EVERY_HOURS).toBe(2);
  expect(RESULTS_PER_RUN).toBe(32);
  expect(MAX_CHARGE_PER_RUN_USD).toBe(0.013);
  expect(31 * (24 / RUN_EVERY_HOURS) * MAX_CHARGE_PER_RUN_USD).toBeLessThanOrEqual(5);
});
it("cada palavra-chave volta antes de a janela de 24 h fechar", () => {
  expect(LINKEDIN_KEYWORDS.length * RUN_EVERY_HOURS).toBeLessThanOrEqual(24);
});
it("não inicia outra se a última começou há menos de 2 h", async () => {
  const recent = runs.data.items.map((r, i) => ({ ...r, startedAt: i === 0 ? "2026-11-23T10:30:00.000Z" : r.startedAt }));
  const ctx = fakeCtx({ serve: serveWith(recent), cursor: "dsNew" });
  await collect(linkedin.fetch(ctx));
  expect(ctx.requests.some((r) => r.method === "POST")).toBe(false);
});
it("inicia outra quando a última começou há 2 h", async () => {
  const due = runs.data.items.map((r, i) => ({ ...r, startedAt: i === 0 ? "2026-11-23T10:00:00.000Z" : r.startedAt }));
  const ctx = fakeCtx({ serve: serveWith(due), cursor: "dsNew" });
  await collect(linkedin.fetch(ctx));
  expect(ctx.requests.filter((r) => r.method === "POST")).toHaveLength(1);
});
```

Renomear `"inicia nova execução quando a última começou há 12 h ou mais..."` para `"...há 2 h ou mais..."` e `"rodízio de buscas muda a cada 12 h"` para `"...a cada 2 h"`, com `01:00` e `03:00` no lugar de `01:00` e `13:00`. Importar `RUN_EVERY_HOURS`.

- [ ] **Passo 2: rodar e ver falhar**

Run: `pnpm vitest run tests/unit/server/sources/linkedin.test.ts`
Esperado: FAIL nas constantes e em "inicia outra quando a última começou há 2 h".

- [ ] **Passo 3: trocar as constantes e os comentários de orçamento**
- [ ] **Passo 4: rodar e ver passar** (mesmo comando). Esperado: PASS.

### Task 6: início de execução tolerante a falha e aviso sem token

**Arquivos:**
- Modificar: `lib/server/sources/linkedin.ts:78-79` e `:104-110`
- Teste: `tests/unit/server/sources/linkedin.test.ts`

**Interfaces:**
- Consome: `ctx.reportPartial(label: string, error: unknown)` (já existe em `ConnectorContext`).

- [ ] **Passo 1: escrever os testes que falham**

```ts
it("falha ao iniciar a execução não perde o dataset: entrega as vagas, grava o cursor e reporta parcial", async () => {
  const due = runs.data.items.map((r, i) => ({ ...r, startedAt: i === 0 ? "2026-11-23T09:00:00.000Z" : r.startedAt }));
  const base = serveWith(due);
  const ctx = fakeCtx({
    serve: (url, init) => {
      if (init?.method === "POST") throw new Error("resposta HTTP 402 de api.apify.com");
      return base(url, init);
    },
    cursor: "dsOld",
  });
  const raws = (await collect(linkedin.fetch(ctx))) as { id: string }[];
  expect(raws.map((r) => r.id)).toEqual(dataset.map((d) => d.id));
  expect(ctx.cursors.at(-1)).toBe("dsNew");
  expect(ctx.partials).toHaveLength(1);
  expect(ctx.partials[0]!.label).toBe("apify:start");
});
it("sem APIFY_TOKEN avisa no log", async () => {
  vi.stubEnv("APIFY_TOKEN", "");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  await collect(linkedin.fetch(fakeCtx({ serve: serveWith(runs.data.items) })));
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("APIFY_TOKEN"));
  warn.mockRestore();
});
```

- [ ] **Passo 2: rodar e ver falhar** (`pnpm vitest run tests/unit/server/sources/linkedin.test.ts`). Esperado: FAIL nos dois.
- [ ] **Passo 3: implementar**

POST dentro de `try/catch`; no `catch`, `ctx.reportPartial("apify:start", e)`. Sem token: `console.warn("[coleta] linkedin: APIFY_TOKEN ausente, a fonte não coleta nada.")` e `return` (a cada coleta; um aviso por hora é aceitável e dispensa estado de módulo).

- [ ] **Passo 4: rodar e ver passar** (mesmo comando). Esperado: PASS.

### Task 7: ingerir todas as execuções novas

**Arquivos:**
- Modificar: `lib/server/sources/linkedin.ts:85-98`
- Teste: `tests/unit/server/sources/linkedin.test.ts` (inclui o `serveWith`, que passa a servir também `/v2/datasets/dsOld/items`)

**Interfaces:**
- Produz: comportamento do `fetch`: com `ctx.cursor` igual ao dataset de uma execução da lista, ingere só as `SUCCEEDED` mais novas que ela; com cursor ausente ou fora da lista, ingere todas as `SUCCEEDED` da lista. Ordem: da mais antiga para a mais nova. `ctx.setCursor(datasetId)` depois de cada dataset.

- [ ] **Passo 1: escrever/ajustar os testes**

`serveWith` ganha `if (url.pathname === "/v2/datasets/dsOld/items") return datasetOld;`, com `const datasetOld = [{ ...dataset[0]!, id: "old-1" }]`.

```ts
it("sem cursor, ingere todas as execuções bem-sucedidas, da mais antiga para a mais nova", async () => {
  const ctx = fakeCtx({ serve: serveWith(runs.data.items) });
  const raws = (await collect(linkedin.fetch(ctx))) as { id: string }[];
  expect(raws.map((r) => r.id)).toEqual(["old-1", ...dataset.map((d) => d.id)]);
  expect(ctx.cursors).toEqual(["dsOld", "dsNew"]);
});
it("com o cursor numa execução antiga, ingere só as mais novas", async () => {
  const ctx = fakeCtx({ serve: serveWith(runs.data.items), cursor: "dsOld" });
  const raws = (await collect(linkedin.fetch(ctx))) as { id: string }[];
  expect(raws.map((r) => r.id)).toEqual(dataset.map((d) => d.id));
  expect(ctx.cursors).toEqual(["dsNew"]);
});
it("ignora execuções que falharam no meio da lista", async () => {
  const items = [runs.data.items[0]!, { ...runs.data.items[1]!, status: "FAILED" }];
  const ctx = fakeCtx({ serve: serveWith(items) });
  const raws = (await collect(linkedin.fetch(ctx))) as { id: string }[];
  expect(raws.map((r) => r.id)).toEqual(dataset.map((d) => d.id));
});
```

O teste `"ingere o dataset da última execução bem-sucedida e grava o cursor"` passa a usar `cursor: "dsOld"` (mesmas asserções). `"não reingere um dataset já lido"` fica como está.

- [ ] **Passo 2: rodar e ver falhar** (`pnpm vitest run tests/unit/server/sources/linkedin.test.ts`). Esperado: FAIL nos dois primeiros testes novos.
- [ ] **Passo 3: implementar**

`const idx = items.findIndex((r) => r.defaultDatasetId === ctx.cursor)`; candidatas = `(idx === -1 ? items : items.slice(0, idx))`, filtradas por `SUCCEEDED` com `defaultDatasetId`, em ordem reversa. Para cada uma, o mesmo GET do dataset de hoje, `yield` dos itens e `ctx.setCursor`. A decisão de iniciar execução (`latest = items[0]`) não muda.

- [ ] **Passo 4: verificação da fase**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Esperado: tudo verde.

---

## Paralelismo

- Fase 1: Tarefa 1 → Tarefas 2 e 3 (dependem da remoção de `purgeExpired`; 2 e 3 não se tocam e podem rodar em paralelo).
- Fase 2: Tarefa 4 depois da Fase 1 (documenta o comportamento final).
- Fase 3: Tarefas 5 → 6 → 7 em sequência (mesmo arquivo), em paralelo com a Fase 1.

## Pós-deploy (manual)

- Conferir no painel da Vercel que os dois agendamentos (`collect` e `purge`) aparecem. Se o Hobby recusar o segundo, plano B da spec: `runCollection` chama `purgeOld` em toda execução.
- Depois de 24 h: consulta 9.1 da spec com `fetched_count > 0` a cada ~2 h para o LinkedIn, e uso do mês no console do Apify.
