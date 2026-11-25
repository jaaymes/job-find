# Deduplicação entre fontes e catálogo único de fontes — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** a mesma vaga vinda de fontes diferentes aparece uma vez só, e adicionar uma fonte nova toca o mínimo de arquivos.

**Arquitetura:** a chave de dedup ganha normalização de empresa e título; a URL canônica passa a conhecer os ATS. Uma função `mergeJobs` funde vagas ativas, usada pelo upsert (colisão) e por um script único de recálculo de chaves. Um catálogo em `lib/shared/sources.ts` vira a fonte única de ids, rótulos e confiança.

**Stack:** Next.js + TypeScript, Drizzle ORM (Postgres/Neon), Vitest (projetos `unit*` e `integration`), `tsx` para scripts.

**Spec:** [docs/tech/2026-11-25-deduplicacao-e-catalogo-de-fontes.md](../tech/2026-11-25-deduplicacao-e-catalogo-de-fontes.md)

## Restrições globais

- Nenhuma variável de ambiente, feature flag ou serviço externo novo (RQ-05; regra do projeto no CONTRIBUTING).
- Nenhuma migração de schema neste plano (a Fase 3 da spec, `match_key`, é condicional e terá plano próprio).
- A normalização vale **só para a chave**; `company` e `title` gravados continuam como a fonte mandou.
- A `url_canonical` é exibida em "Minhas vagas" e no gerador: toda transformação mantém uma URL que abre a mesma vaga; a caixa do caminho é preservada.
- Falso positivo é pior que duplicata (RQ-02): listas fechadas, nada de sinônimos de cargo nem palavras genéricas de empresa.
- Textos para o usuário e comentários em pt-BR; identificadores em inglês, seguindo o código existente.
- Verificação de cada tarefa: `pnpm typecheck && pnpm lint && pnpm test`; tarefas com banco também `pnpm db:test:up && pnpm test:integration`.
- Commits só se o usuário autorizou commits na execução.

## Foco de revisão

1. **Títulos com `C#`, `C++`, `.NET`:** trocar pontuação por espaço não pode fundir "C# Developer" com "C++ Developer". Teste na Tarefa 2.
2. **Troca de chaves no recálculo:** a nova chave de A pode ser a chave antiga de B; atualizar em sequência violaria o índice único. Teste na Tarefa 7.
3. **Nome de empresa que é só sufixo** ("GmbH", "S.A."): nunca vira string vazia. Teste na Tarefa 2.
4. **Fusão com fontes repetidas:** sobrevivente e perdedora com a mesma fonte não podem gerar `sources` duplicado. Teste na Tarefa 4.
5. **Colisão vinda de fonte menos confiável** (HN atualizando uma vaga): não funde nem lança erro, porque ela não reescreve chave. Teste na Tarefa 5.

---

### Task 1: Catálogo único de fontes e guia de contribuição (D-06, D-07)

Independente das demais tarefas.

**Files:**
- Create: `lib/shared/sources.ts`
- Modify: `lib/shared/types/job.ts:5-20` (o union `SourceId` vira re-export)
- Modify: `lib/shared/schemas/jobs-query.ts:5-21` (`SOURCE_IDS` local sai)
- Modify: `components/jobs/format.ts:3-43` (`SOURCE_LABELS` e `FILTERABLE_SOURCES` viram re-export/derivados)
- Modify: `lib/client/jobs/use-jobs.ts` (lista literal de `urlParsers.source`)
- Modify: `lib/server/sources/trust.ts` (`SOURCE_TRUST` derivado do catálogo; `trustOf` fica)
- Modify: `lib/server/sources/registry.ts` (tipo total + comentário antigo)
- Modify: `lib/server/sources/types.ts:7` (comentário "a Tarefa 10 completa este arquivo")
- Modify: `CONTRIBUTING.md:31-37`
- Test: `tests/unit/shared/sources.test.ts` (novo), `tests/unit/server/sources/registry.test.ts`

**Interfaces:**
- Produces:
  - `SOURCES: readonly { id: string; label: string; trust: 1 | 2 | 3 }[]` (`as const`), na ordem atual de `FILTERABLE_SOURCES`, com os rótulos atuais de `SOURCE_LABELS` e a confiança atual de `SOURCE_TRUST`.
  - `type SourceId = (typeof SOURCES)[number]["id"]`
  - `SOURCE_IDS: readonly [SourceId, ...SourceId[]]` (serve para `z.enum` e `parseAsStringLiteral`)
  - `SOURCE_LABELS: Record<SourceId, string>`, `SOURCE_TRUST: Record<SourceId, 1 | 2 | 3>`
  - `CONNECTORS: Record<SourceId, Connector>` (não mais `Partial`)

- [ ] **Step 1: Escrever os testes que falham**

`tests/unit/shared/sources.test.ts`:
```ts
it("ids são únicos", () => expect(new Set(SOURCE_IDS).size).toBe(SOURCES.length));
it("todo rótulo é não vazio", () => SOURCES.forEach((s) => expect(s.label.trim()).not.toBe("")));
it("confiança é 1, 2 ou 3", () => SOURCES.forEach((s) => expect([1, 2, 3]).toContain(s.trust)));
it("mantém os valores atuais", () => {
  expect(SOURCE_LABELS.wwr).toBe("We Work Remotely");
  expect(SOURCE_TRUST.greenhouse).toBe(3);
  expect(SOURCE_TRUST.hn).toBe(1);
  expect(SOURCE_IDS.length).toBe(15);
});
```
Em `registry.test.ts`, trocar o teste atual por:
```ts
it("cada conector registrado tem o id da própria chave e cobre o catálogo", () => {
  expect(Object.keys(CONNECTORS).sort()).toEqual([...SOURCE_IDS].sort());
  for (const [key, c] of Object.entries(CONNECTORS)) expect(c.id).toBe(key);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/unit/shared/sources.test.ts tests/unit/server/sources/registry.test.ts`
Expected: FAIL (módulo `@/lib/shared/sources` não existe)

- [ ] **Step 3: Criar `lib/shared/sources.ts` e derivar as listas**

`lib/shared/types/job.ts` passa a ter `export type { SourceId } from "@/lib/shared/sources";` (os imports existentes de `SourceId` continuam funcionando). `jobs-query.ts` usa `z.enum(SOURCE_IDS)`; `use-jobs.ts` usa `parseAsStringLiteral(SOURCE_IDS)`; `format.ts` re-exporta `SOURCE_LABELS` e define `FILTERABLE_SOURCES = SOURCE_IDS` (apagar o comentário sobre ids sem conector); `trust.ts` re-exporta `SOURCE_TRUST` do catálogo. Em `registry.ts`, `export const CONNECTORS: Record<SourceId, Connector> = { … }` e trocar o comentário "Preenchido pelas Tarefas…" por um que diga que o TypeScript exige um conector para cada id do catálogo.

- [ ] **Step 4: Reescrever "Adicionar uma fonte de vagas" no CONTRIBUTING.md**

Passos, nesta ordem: (1) issue "Nova fonte de vagas" com o checklist de ToS; (2) análise em `docs/fontes.md`; (3) entrada em `lib/shared/sources.ts` com `id`, `label` e `trust` (3 = ATS da própria empresa, 2 = agregador/job board, 1 = conteúdo livre de usuário); (4) conector em `lib/server/sources/<id>.ts` implementando `Connector` de `lib/server/sources/types.ts`, tendo `jobicy.ts` como exemplo simples; (5) registro em `lib/server/sources/registry.ts` (o TypeScript acusa se faltar); (6) fixtures em `tests/fixtures/sources/<id>/` e teste unitário sem rede; (7) PR com o modelo. Acrescentar uma frase: "A deduplicação entre fontes é automática: o conector só precisa entregar empresa, título e URL corretos." Remover "definida na Tarefa 10 do plano" e "criado na Tarefa 23 do plano" (seção de provedores de IA).

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: tudo PASS, incluindo `tests/unit/components/jobs.test.tsx` (rótulos inalterados)

- [ ] **Step 6: Commit**

```bash
git add lib/shared/sources.ts lib/shared/types/job.ts lib/shared/schemas/jobs-query.ts components/jobs/format.ts lib/client/jobs/use-jobs.ts lib/server/sources/trust.ts lib/server/sources/registry.ts lib/server/sources/types.ts CONTRIBUTING.md tests/unit/shared/sources.test.ts tests/unit/server/sources/registry.test.ts
git commit -m "refactor(fontes): catálogo único de fontes e guia de contribuição atualizado"
```

---

### Task 2: Normalização de empresa e título na chave (D-01, D-02)

Independente.

**Files:**
- Modify: `lib/server/enrich/dedupe.ts`
- Test: `tests/unit/server/enrich/dedupe.test.ts`

**Interfaces:**
- Produces: `normalizeCompany(value: string): string`, `normalizeTitle(value: string): string`, ambas exportadas de `lib/server/enrich/dedupe.ts`. `dedupeKey` mantém a assinatura e passa a usar `normalizeCompany` na empresa e `normalizeTitle` no título (país, cidade e modo seguem com `normalizeText`).

- [ ] **Step 1: Escrever os testes que falham**

```ts
describe("normalizeCompany", () => {
  it("remove sufixo societário no fim", () => {
    expect(normalizeCompany("resonads GmbH")).toBe("resonads");
    expect(normalizeCompany("Enterprise Management Solutions, Inc.")).toBe("enterprise management solutions");
    expect(normalizeCompany("Nu Pagamentos S.A.")).toBe("nu pagamentos");
    expect(normalizeCompany("Foo Co., Ltd.")).toBe("foo");
    expect(normalizeCompany("Lumen Pay Ltda")).toBe("lumen pay");
  });
  it("não remove no meio nem palavras genéricas", () => {
    expect(normalizeCompany("Acme Labs")).not.toBe(normalizeCompany("Acme"));
    expect(normalizeCompany("Coinbase")).toBe("coinbase");
    expect(normalizeCompany("Inc Studio")).toBe("inc studio");
  });
  it("nome que é só sufixo não fica vazio", () => {
    expect(normalizeCompany("GmbH")).toBe("gmbh");
    expect(normalizeCompany("S.A.")).not.toBe("");
  });
});

describe("normalizeTitle", () => {
  it("remove marcador de gênero", () => {
    expect(normalizeTitle("Backend Developer (m/w/d)")).toBe("backend developer");
    expect(normalizeTitle("Backend Developer (f/m/d)")).toBe("backend developer");
    expect(normalizeTitle("Desenvolvedor(a) Python")).toBe("desenvolvedor python");
    expect(normalizeTitle("Dev [all genders]")).toBe("dev");
  });
  it("remove segmento final só de modo ou região", () => {
    expect(normalizeTitle("Sr. Backend Engineer - Remote")).toBe("senior backend engineer");
    expect(normalizeTitle("Engenheiro de Dados (Remoto - Brasil)")).toBe("engenheiro de dados");
    expect(normalizeTitle("Frontend Engineer | LATAM")).toBe("frontend engineer");
    expect(normalizeTitle("Remote Sensing Engineer")).toBe("remote sensing engineer");
  });
  it("iguala abreviações de senioridade", () => {
    expect(normalizeTitle("Jr Dev")).toBe(normalizeTitle("Junior Dev"));
    expect(normalizeTitle("Dev PL")).toBe("dev pleno");
  });
  it("não funde cargos distintos", () => {
    expect(normalizeTitle("Data Engineer")).not.toBe(normalizeTitle("Data Developer"));
    expect(normalizeTitle("C# Developer")).not.toBe(normalizeTitle("C++ Developer"));
    expect(normalizeTitle(".NET Developer")).not.toBe(normalizeTitle("Developer"));
  });
});

it("dedupeKey: ATS e agregador com sufixo e marcador diferentes geram a mesma chave", () => {
  const loc = { country: "DE", city: "Berlin", workMode: "onsite" } as const;
  expect(dedupeKey({ company: "resonads GmbH", title: "Backend Developer (m/w/d)", ...loc }))
    .toBe(dedupeKey({ company: "resonads", title: "Backend Developer", ...loc }));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/unit/server/enrich/dedupe.test.ts`
Expected: FAIL (`normalizeCompany` não exportada)

- [ ] **Step 3: Implementar em `lib/server/enrich/dedupe.ts`**

Valores fixados pela spec:
- Sufixos (comparados depois de `normalizeText` e de trocar pontuação por espaço; removidos só no fim, repetidamente): `inc`, `llc`, `ltd`, `limited`, `ltda`, `sa`, `s a`, `s/a`, `me`, `eireli`, `gmbh`, `ag`, `corp`, `corporation`, `co`, `plc`, `bv`, `b v`, `srl`, `sas`, `oy`, `ab`, `pty`. Se sobrar vazio, devolve o nome normalizado sem remover sufixos.
- Marcadores de gênero (entre parênteses ou colchetes, ou `(a)`/`(o)` colado na palavra): `m/w/d`, `m/f/d`, `f/m/d`, `w/m/d`, `m/f/x`, `f/m/x`, `h/f`, `f/h`, `m/f`, `all genders`, `a/e/o`, `a`, `o`.
- Palavras de modo/região para o segmento final (entre parênteses ou depois de ` - `, ` – `, ` | `), que só é removido se **todas** as palavras dele estiverem na lista: `remote`, `remoto`, `hybrid`, `hibrido`, `onsite`, `on-site`, `presencial`, `home office`, `brazil`, `brasil`, `latam`, `worldwide`, `anywhere`.
- Abreviações (palavra inteira): `sr` → `senior`, `jr` → `junior`, `pl` → `pleno`.
- Pontuação trocada por espaço: `. , ; : ! ? ( ) [ ] / \ - _ | " '`. **Não** trocar `+` nem `#`.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run tests/unit/server/enrich/dedupe.test.ts && pnpm test`
Expected: PASS (os testes antigos da RN-05 continuam passando)

- [ ] **Step 5: Commit**

```bash
git add lib/server/enrich/dedupe.ts tests/unit/server/enrich/dedupe.test.ts
git commit -m "feat(dedup): normaliza empresa e título na chave de deduplicação"
```

---

### Task 3: URL canônica ciente dos ATS (D-03)

Independente.

**Files:**
- Create: `lib/server/enrich/canonical-url.ts` (a função sai de `enrich-job.ts`)
- Modify: `lib/server/jobs/enrich-job.ts:50-62` (importa `canonicalUrl`)
- Test: `tests/unit/server/enrich/canonical-url.test.ts`

**Interfaces:**
- Produces: `canonicalUrl(raw: string): string | null` exportada de `lib/server/enrich/canonical-url.ts` (mantém o comportamento atual: `safeUrl`, sem fragmento, sem parâmetros de rastreamento).

- [ ] **Step 1: Escrever os testes que falham**

```ts
it.each([
  ["https://job-boards.greenhouse.io/acme/jobs/123?gh_src=x", "https://boards.greenhouse.io/acme/jobs/123"],
  ["https://job-boards.eu.greenhouse.io/acme/jobs/1", "https://boards.eu.greenhouse.io/acme/jobs/1"],
  ["https://jobs.lever.co/acme/abc-123/apply", "https://jobs.lever.co/acme/abc-123"],
  ["https://jobs.ashbyhq.com/acme/0f1e/application", "https://jobs.ashbyhq.com/acme/0f1e"],
  ["https://WWW.Example.com/Jobs/ABC/", "https://example.com/Jobs/ABC"],
  ["https://example.com/", "https://example.com/"],
  ["https://example.com/j?b=2&a=1&utm_source=x#top", "https://example.com/j?a=1&b=2"],
  ["https://example.com/jobs/1/apply", "https://example.com/jobs/1/apply"],
  ["https://jobs.smartrecruiters.com/AcmeBR/7440-Dev", "https://jobs.smartrecruiters.com/AcmeBR/7440-Dev"],
])("%s → %s", (raw, expected) => expect(canonicalUrl(raw)).toBe(expected));

it("URL insegura vira null", () => expect(canonicalUrl("javascript:alert(1)")).toBeNull());
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/unit/server/enrich/canonical-url.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar `canonicalUrl` em `canonical-url.ts`**

Regras da spec, depois das atuais: host em minúsculas sem `www.`; `job-boards.greenhouse.io` → `boards.greenhouse.io` e `job-boards.eu.greenhouse.io` → `boards.eu.greenhouse.io`; sufixo `/apply` removido só em `jobs.lever.co`; sufixo `/application` removido só em `jobs.ashbyhq.com`; barra final removida, menos na raiz; `searchParams.sort()`. O caminho mantém a caixa.

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run tests/unit/server/enrich/canonical-url.test.ts && pnpm test`
Expected: PASS. Se `tests/unit/jobs/enrich-job.test.ts` tiver URL esperada com barra final ou `www.`, atualizar a expectativa para a forma canônica nova.

- [ ] **Step 5: Commit**

```bash
git add lib/server/enrich/canonical-url.ts lib/server/jobs/enrich-job.ts tests/unit/server/enrich/canonical-url.test.ts tests/unit/jobs/enrich-job.test.ts
git commit -m "feat(dedup): URL canônica junta as variações dos ATS"
```

---

### Task 4: `mergeJobs` (D-05)

Independente. Usa o banco de teste.

**Files:**
- Create: `lib/server/jobs/merge.ts`
- Test: `tests/integration/jobs/merge.test.ts`

**Interfaces:**
- Consumes: `trustOf` de `lib/server/sources/trust.ts`; `Db` de `lib/server/db/client.ts`.
- Produces: `mergeJobs(db: Db, jobIds: number[], now: Date): Promise<number>`. Recebe ids de vagas **ativas** (duplicados ignorados; com um id só, devolve ele sem gravar). Escolhe a sobrevivente: maior `max(trustOf(fonte))` entre as fontes da vaga, depois `first_seen_at` mais antigo, depois menor id. Ordem das gravações: (1) `expired_at = now` nas perdedoras; (2) `job_sources.job_id = sobrevivente` onde `job_id` está entre as perdedoras; (3) na sobrevivente, `sources` = união distinta ordenada de todas, `published_at` = o menor de todas, `updated_at = now`. Devolve o id da sobrevivente. Não abre transação: quem chama decide.

- [ ] **Step 1: Escrever os testes que falham**

Com `upsertJob` e `makeJob` (de `./helpers`) para criar A (greenhouse `g-1`, `dedupeKey: "dk-a"`, URL a, `publishedAt: addDays(T0, -5)`) e B (himalayas `h-1`, `dedupeKey: "dk-b"`, URL b, `publishedAt: addDays(T0, -9)`):
```ts
it("funde na mais confiável, move as fontes e expira a perdedora", async () => {
  const survivor = await mergeJobs(db, [b.jobId!, a.jobId!], addDays(T0, 1));
  expect(survivor).toBe(a.jobId);
  expect((await getRow(db, b.jobId)).expiredAt).toEqual(addDays(T0, 1));
  expect((await getSource(db, "himalayas", "h-1"))?.jobId).toBe(a.jobId);
  const row = await getRow(db, a.jobId);
  expect(row.sources).toEqual(["greenhouse", "himalayas"]);
  expect(row.publishedAt).toEqual(addDays(T0, -9));
});
it("empate de confiança: fica a vista primeiro", async () => { /* duas himalayas, T0 e T0+1 → sobrevive a de T0 */ });
it("fonte repetida não duplica sources", async () => { /* duas greenhouse (g-1, g-2) → sources ["greenhouse"] */ });
it("um id só não grava nada", async () => { expect(await mergeJobs(db, [a.jobId!, a.jobId!], T0)).toBe(a.jobId); });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm db:test:up && pnpm vitest run --project integration tests/integration/jobs/merge.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar `mergeJobs` em `lib/server/jobs/merge.ts`**

Para a união de `sources`, reaproveitar o padrão de `upsert.ts` (`ARRAY(SELECT DISTINCT s FROM unnest(...) AS s ORDER BY s)`).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run --project integration tests/integration/jobs/merge.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/server/jobs/merge.ts tests/integration/jobs/merge.test.ts
git commit -m "feat(dedup): mergeJobs funde vagas ativas na mais confiável"
```

---

### Task 5: Upsert funde em vez de manter a chave antiga

Depende da Task 4.

**Files:**
- Modify: `lib/server/jobs/upsert.ts:131-157` (ramo `targetId !== undefined`)
- Test: `tests/integration/jobs/upsert.test.ts`

**Interfaces:**
- Consumes: `mergeJobs(db, jobIds, now): Promise<number>` (Task 4).
- Produces: `upsertJob` com a mesma assinatura e os mesmos status.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it("colisão de chave na atualização funde as duas vagas", async () => {
  const a = await upsertJob(db, makeJob({ dedupeKey: "dk-a", urlCanonical: "https://a.example/1" }), ref, T0);
  const b = await upsertJob(db, makeJob({ dedupeKey: "dk-b", urlCanonical: "https://b.example/1", contentHash: "hb" }), ref2, T0);
  const t1 = addDays(T0, 1);
  const r = await upsertJob(db, makeJob({ dedupeKey: "dk-b", urlCanonical: "https://a.example/1", contentHash: "h-new" }), ref, t1);
  expect(r.status).toBe("updated");
  const active = await db.select().from(jobs).where(isNull(jobs.expiredAt));
  expect(active).toHaveLength(1);
  expect(active[0].dedupeKey).toBe("dk-b");
  expect(active[0].sources).toEqual(["greenhouse", "himalayas"]);
});
it("colisão de URL na atualização funde as duas vagas", async () => { /* mesmo cenário trocando o papel de chave e URL */ });
it("fonte menos confiável colidindo não funde nem lança erro", async () => {
  // ref3 = { source: "hn", externalId: "hn-1", url: "https://news.ycombinator.com/item?id=1" } as const
  /* A greenhouse dk-a; B hn (ref3) dk-b; hn atualiza B com dedupeKey dk-a → 2 ativas, sem exceção */
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run --project integration tests/integration/jobs/upsert.test.ts`
Expected: FAIL (duas vagas ativas)

- [ ] **Step 3: Implementar**

No ramo de atualização, quando `canOverwrite` e `keyOwner` ou `urlOwner` existem com id diferente de `targetId`: `targetId = await mergeJobs(db, [targetId, keyOwner?.id, urlOwner?.id].filter(...), now)`. Depois disso a atualização segue gravando `dedupeKey` e `urlCanonical` sem a guarda de colisão, porque as outras linhas já expiraram. Sem `canOverwrite`, o comportamento atual fica igual. Atualizar o comentário da função (o terceiro parágrafo passa a dizer que colisão funde).

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run --project integration && pnpm typecheck`
Expected: PASS (inclusive os testes antigos de upsert e de coleta)

- [ ] **Step 5: Commit**

```bash
git add lib/server/jobs/upsert.ts tests/integration/jobs/upsert.test.ts
git commit -m "fix(upsert): colisão de chave ou URL funde as vagas em vez de manter duplicata"
```

---

### Task 6: Teste ponta a ponta da deduplicação entre fontes

Depende das Tasks 2 e 3.

**Files:**
- Test: `tests/integration/jobs/upsert.test.ts`

- [ ] **Step 1: Escrever o teste**

Seguindo o uso de `enrichJob` que já existe em `upsert.test.ts`: um `NormalizedJob` da greenhouse (`company: "resonads GmbH"`, `title: "Backend Developer (m/w/d)"`, `url: "https://job-boards.greenhouse.io/resonads/jobs/1"`, Berlin/DE/`onsite`) e outro da arbeitnow (`company: "resonads"`, `title: "Backend Developer"`, outra URL, mesma localização). Os dois passam por `enrichJob` e `upsertJob`. Esperado: uma vaga ativa com `sources` `["arbeitnow", "greenhouse"]`, `company` gravado `"resonads GmbH"` (a greenhouse é mais confiável) e `url_canonical` `"https://boards.greenhouse.io/resonads/jobs/1"`.

- [ ] **Step 2: Rodar e ver passar**

Run: `pnpm vitest run --project integration tests/integration/jobs/upsert.test.ts`
Expected: PASS (se falhar, o defeito está na Task 2 ou 3, não neste teste)

- [ ] **Step 3: Commit**

```bash
git add tests/integration/jobs/upsert.test.ts
git commit -m "test(dedup): mesma vaga de ATS e agregador vira uma linha"
```

---

### Task 7: Recálculo das chaves existentes (D-05)

Depende das Tasks 2, 3 e 4.

**Files:**
- Create: `lib/server/jobs/rekey.ts`
- Create: `scripts/rekey-jobs.ts`
- Modify: `package.json` (script `"db:rekey": "tsx scripts/rekey-jobs.ts"`)
- Test: `tests/unit/jobs/rekey.test.ts`, `tests/integration/jobs/rekey.test.ts`

**Interfaces:**
- Consumes: `dedupeKey` (Task 2), `canonicalUrl` (Task 3), `mergeJobs` (Task 4), `acquireLock`/`releaseLock` de `lib/server/collect/lock.ts`, `SOURCE_IDS` (Task 1, ou a lista atual se a Task 1 ainda não entrou), `UNKNOWN_COMPANY` de `lib/server/sources/types.ts`.
- Produces:
  - `type RekeyRow = { id: number; company: string; title: string; country: string | null; city: string | null; workMode: WorkMode; dedupeKey: string; urlCanonical: string }`
  - `type RekeyGroup = { ids: number[]; next: Record<number, { dedupeKey: string; urlCanonical: string }> }`
  - `loadRekeyRows(db: Db): Promise<RekeyRow[]>`: vagas ativas, menos as de empresa vazia ou `UNKNOWN_COMPANY`.
  - `planRekey(rows: RekeyRow[]): RekeyGroup[]`: função pura. Calcula a chave e a URL novas de cada linha e agrupa por união transitiva (mesma chave nova **ou** mesma URL nova). Devolve os grupos com mais de um id e os de um id só cuja chave ou URL mudou.
  - `applyRekey(db: Db, groups: RekeyGroup[], now: Date): Promise<{ merged: number; rekeyed: number }>`: (1) grava `dedupe_key = 'rekey:' || id` e `url_canonical = 'rekey:' || id` em todos os ids dos grupos, para nenhuma troca violar o índice único no meio do caminho; (2) por grupo, `survivor = ids.length > 1 ? await mergeJobs(db, ids, now) : ids[0]`; (3) grava `next[survivor]` na sobrevivente. `merged` conta as perdedoras; `rekeyed` conta as sobreviventes gravadas.

- [ ] **Step 1: Escrever os testes unitários que falham (`planRekey`)**

```ts
it("agrupa empresa com e sem sufixo", () => {
  expect(planRekey([row(1, "resonads GmbH", "Backend Developer (m/w/d)"), row(2, "resonads", "Backend Developer")]).map((g) => g.ids))
    .toEqual([[1, 2]]);
});
it("agrupa pela URL nova", () => { /* job-boards.greenhouse.io × boards.greenhouse.io, títulos diferentes → [[1, 2]] */ });
it("transitivo: 1~2 pela chave e 2~3 pela URL", () => { /* → [[1, 2, 3]] */ });
it("linha que não muda não gera grupo", () => { /* row já com dedupeKey/urlCanonical novos → [] */ });
it("linha cuja chave mudou sozinha gera grupo de um", () => { /* → [{ ids: [1], next: {1: …} }] */ });
```
(`row(id, company, title, url?)` é um helper local que preenche Berlin/DE/`onsite` e uma `dedupeKey` antiga qualquer.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run tests/unit/jobs/rekey.test.ts`
Expected: FAIL (módulo não existe)

- [ ] **Step 3: Implementar `planRekey` e `loadRekeyRows`; rodar e ver passar**

Run: `pnpm vitest run tests/unit/jobs/rekey.test.ts`
Expected: PASS

- [ ] **Step 4: Escrever os testes de integração que falham (`applyRekey`)**

```ts
it("funde, regrava a chave e deixa a integridade em zero", async () => {
  /* insere A (greenhouse, "resonads GmbH", "Backend Developer (m/w/d)") e B (arbeitnow, "resonads", "Backend Developer")
     com dedupe_key antigas distintas → applyRekey(db, planRekey(await loadRekeyRows(db)), T0) */
  expect(result).toEqual({ merged: 1, rekeyed: 1 });
  /* consulta 5.4 de scripts/db-audit.sql: chave_dup = 0, url_dup = 0, ativa_sem_fonte = 0 */
});
it("troca de chaves entre duas vagas não viola o índice único", async () => {
  /* A tem como chave antiga a chave nova de B, e B precisa trocar a sua → sem exceção, cada uma com a chave nova */
});
it("rodar duas vezes não muda nada na segunda", async () => {
  expect(planRekey(await loadRekeyRows(db))).toEqual([]);
});
```

- [ ] **Step 5: Implementar `applyRekey`; rodar e ver passar**

Run: `pnpm vitest run --project integration tests/integration/jobs/rekey.test.ts`
Expected: PASS

- [ ] **Step 6: Escrever `scripts/rekey-jobs.ts`**

Primeira linha: `import "./discover-boards/server-only-shim";`. Fluxo: lê `--apply` com `parseArgs`; `db = getPoolDb()`; pega `acquireLock(db, id, 300_000)` de todas as fontes de `SOURCE_IDS`; se alguma falhar, libera as que pegou, imprime "Coleta em andamento na fonte <id>; tente de novo em alguns minutos." e sai com código 1. Carrega, planeja e imprime: total de vagas lidas, grupos a fundir, vagas que expiram, vagas com chave regravada e até 20 amostras (`empresa — título` de cada id do grupo). Sem `--apply`, imprime "Simulação: nada foi gravado. Rode com --apply para aplicar." Com `--apply`, `await db.transaction((tx) => applyRekey(tx, groups, new Date()))` e imprime o resultado. No `finally`, libera todos os locks. Comentário de cabeçalho no padrão de `scripts/discover-boards.ts`, com os dois comandos de uso.

- [ ] **Step 7: Conferir o script contra o banco de teste**

Run: `DATABASE_URL=<url do docker-compose.test.yml> pnpm db:rekey`
Expected: imprime a simulação e "nada foi gravado"; código de saída 0.

- [ ] **Step 8: Rodar tudo**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/server/jobs/rekey.ts scripts/rekey-jobs.ts package.json tests/unit/jobs/rekey.test.ts tests/integration/jobs/rekey.test.ts
git commit -m "feat(dedup): script de recálculo das chaves com simulação e fusão"
```

---

### Task 8: Implantação e medição em produção (Fases 0 e 2 da spec)

Depende de todas. Passos manuais no banco de produção: **cada um só com o "sim" do usuário**.

- [ ] **Step 1: Linha de base** — o usuário roda a consulta 5.3 de `scripts/db-audit.sql` no editor SQL do Neon, antes do deploy. Anotar o número de linhas na seção 5 da spec.
- [ ] **Step 2: Deploy** das Tasks 1–7 (merge na `main`; sem migração de schema).
- [ ] **Step 3: Simulação** — `DATABASE_URL=<produção> pnpm db:rekey`. Mostrar a saída ao usuário e conferir as 20 amostras e, principalmente, todos os grupos listados em "Grupos com títulos diferentes (confira antes do --apply): N" atrás de falso positivo. Se houver algum, parar e voltar à Task 2. Anotar também "Vagas regravadas" (usado no Step 4).
- [ ] **Step 4: Aplicar** — `pnpm db:rekey --apply`, com o "sim" do usuário. Rodar depois que a coleta das :17 (horário no `vercel.json`) terminar, por volta das :22, e antes da próxima: o script pega o lock de todas as fontes com TTL de 5 min e aborta se alguma estiver coletando. Usar "Vagas regravadas" da simulação para estimar a duração e confirmar que cabe nos 5 min do lock.
- [ ] **Step 5: Conferir** — consultas 5.3 (deve cair em relação à linha de base) e 5.4 (tudo em zero). Comparar a duração média por fonte em `source_runs` (`finished_at - started_at`) antes e depois do deploy, para ver o custo da fusão e das vagas fundidas com fontes de mesma confiança, que perdem o atalho por hash. Anotar os números na spec e mudar o status dela para "implementada e em produção".
- [ ] **Step 6: Decidir a Fase 3** — se a 5.3 ainda mostrar grupos que diferem só em cidade ou modo, propor um plano próprio para a D-04 (`match_key`). Se não, registrar na spec que a D-04 não foi necessária.

---

## Dependências e paralelismo

| Task | Depende de | Pode rodar em paralelo com |
|---|---|---|
| 1 Catálogo | — | 2, 3, 4 |
| 2 Normalização | — | 1, 3, 4 |
| 3 URL canônica | — | 1, 2, 4 |
| 4 mergeJobs | — | 1, 2, 3 |
| 5 Upsert funde | 4 | 6 (depois de 2 e 3) |
| 6 Ponta a ponta | 2, 3 | 5 |
| 7 Recálculo | 2, 3, 4 | — |
| 8 Produção | 1–7 | — |

As Tasks 2 e 5 tocam arquivos diferentes; as Tasks 5 e 6 tocam o mesmo arquivo de teste (`upsert.test.ts`), então rodam em sequência.
