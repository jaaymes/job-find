# Fonte RemoteJobs.org e "Fontes" no header: plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** coletar vagas do RemoteJobs.org de hora em hora e deixar o link "Fontes" visível no header (desktop e celular).

**Arquitetura:** novo conector `lib/server/sources/remotejobs.ts` no molde de `jobicy.ts` (fetch paginado por `offset`, snapshot completo de `country=BR`), registrado no catálogo único `lib/shared/sources.ts` e no `CONNECTORS`. Navegação: item no `PRIMARY_NAV` (desktop) e link compacto `md:hidden` no `SiteHeader` (celular); sai do rodapé.

**Stack:** Next.js (App Router), TypeScript, zod (`@/lib/shared/zod`), Vitest + Testing Library, lucide-react.

**Spec:** `docs/tech/2026-11-25-fonte-remotejobs-e-fontes-no-header.md`

## Restrições globais

- Gratuito, sem chave e sem variável de ambiente nova; a fonte entra ativa (sem feature flag).
- Host fixo `remotejobs.org`; endpoint `https://remotejobs.org/api/v1/jobs?country=BR&sort=recent&limit=50&offset=<n>`.
- Teto de 30 páginas por coleta; limite da fonte: 200 req/h por IP.
- `id: "remotejobs"`, rótulo `"RemoteJobs.org"`, `trust: 2`, `brazilian: false`, `fullSnapshot: true`, `minIntervalMinutes: 60`.
- Atribuição `{ label: "RemoteJobs.org", url: "https://remotejobs.org", dofollow: false }`; o link da vaga é a `url` do remotejobs.org, intacta.
- Textos de UI em pt-BR; identificadores em inglês, como no resto do código.
- Não commitar sem pedido do mantenedor: os passos de commit só rodam se ele autorizar.

## Foco da revisão

1. Lista incompleta (teto de páginas ou prazo da fonte esgotado) não pode expirar vagas: o conector chama `ctx.reportPartial` (teste na Tarefa 1).
2. Página com HTTP ≠ 200 ou JSON fora do formato no meio da paginação derruba a coleta inteira, em vez de entregar metade como snapshot (teste na Tarefa 1).
3. Vaga repetida entre páginas (deslocamento por `sort=recent`) sai uma vez só (teste na Tarefa 1).
4. Entidades HTML no nome da empresa e no título (`&amp;`) aparecem decodificadas na tela (teste na Tarefa 1).
5. No celular, os dois links "Fontes" (nav desktop oculta e link compacto) não podem confundir leitor de tela: o nav desktop já é `hidden md:flex` e o link compacto é `md:hidden`, então só um fica no layout por vez (teste na Tarefa 2 checa as classes).

---

### Task 1: conector RemoteJobs.org

**Arquivos:**
- Criar: `lib/server/sources/remotejobs.ts`
- Criar: `tests/fixtures/sources/remotejobs/page-1.json`, `page-2.json`
- Criar: `tests/unit/server/sources/remotejobs.test.ts`
- Modificar: `lib/shared/sources.ts` (nova entrada no fim de `SOURCES`)
- Modificar: `lib/server/sources/registry.ts` (import e chave `remotejobs` em ordem alfabética)
- Modificar: `tests/unit/shared/sources.test.ts:12` (`15` → `16`)
- Modificar: `tests/contract/sources.contract.test.ts` (import de `jobSchema as remotejobsJob` e um `it` como o do jobicy)
- Modificar: `docs/fontes.md` (linha na tabela "Fontes implementadas" e `REMOTEJOBS_HOST` na lista de hosts)

**Interfaces:**
- Consome: `Connector`, `ConnectorContext`, `NormalizedJob` (`lib/server/sources/types.ts`); `safeUrl` (`@/lib/shared/url`); `decodeEntities` (`lib/server/sources/text.ts`); `countryNameFromCode` (`lib/server/sources/location.ts`); `fakeCtx`, `collect` (`tests/unit/server/sources/helpers.ts`).
- Produz: `export const REMOTEJOBS_HOST = "remotejobs.org"`, `export const jobSchema` (zod), `export const remotejobs: Connector`.

- [ ] **Passo 1: gerar as fixtures**

Gravar duas páginas reais e reduzir cada uma a 5 itens, marcando a última página como final:

```bash
mkdir -p tests/fixtures/sources/remotejobs
curl -sS "https://remotejobs.org/api/v1/jobs?country=BR&sort=recent&limit=50&offset=0" | python3 -c "import json,sys;d=json.load(sys.stdin);d['data']=d['data'][:5];d['pagination'].update(limit=5,offset=0,total=8,has_more=True);json.dump(d,open('tests/fixtures/sources/remotejobs/page-1.json','w'),indent=1,ensure_ascii=False)"
curl -sS "https://remotejobs.org/api/v1/jobs?country=BR&sort=recent&limit=50&offset=50" | python3 -c "import json,sys;d=json.load(sys.stdin);d['data']=d['data'][:3];d['pagination'].update(limit=5,offset=5,total=8,has_more=False);json.dump(d,open('tests/fixtures/sources/remotejobs/page-2.json','w'),indent=1,ensure_ascii=False)"
```

Garantir à mão nas fixtures: um item com `company.name` contendo `&amp;`, um com `salary_min`/`salary_currency`/`salary_period: "year"`, um `worldwide`, e o último item da página 1 repetido como primeiro da página 2 (simula o deslocamento). O conector usa `limit=50`; o teste serve as fixtures por `offset` (`0` → page-1, `50` → page-2).

- [ ] **Passo 2: escrever os testes que falham** em `tests/unit/server/sources/remotejobs.test.ts`

Casos (nomes e asserções):

```ts
it("declara os metadados da spec e está registrado", () => {
  expect(remotejobs).toMatchObject({ id: "remotejobs", fullSnapshot: true, brazilian: false, minIntervalMinutes: 60 });
  expect(remotejobs.allowedHosts).toEqual([REMOTEJOBS_HOST]);
  expect(remotejobs.attribution).toEqual({ label: "RemoteJobs.org", url: "https://remotejobs.org", dofollow: false });
  expect(CONNECTORS.remotejobs).toBe(remotejobs);
});
it("pagina com country=BR&sort=recent&limit=50 até has_more=false", async () => {
  // requests: offset=0 e offset=50; todas com country=BR, sort=recent, limit=50
});
it("id repetido entre páginas sai uma vez", async () => { /* raws.length === 7 (5 + 3 - 1) */ });
it("teto de 30 páginas com has_more=true reporta parcial", async () => {
  // serve sempre has_more:true com ids novos; espera 30 requests e ctx.partials.length === 1
});
it("prazo da fonte esgotado reporta parcial e para", async () => {
  // fakeCtx({ deadlineAt: Date.now() - 1 }); espera 0 requests, raws vazio e ctx.partials.length === 1
});
it("HTTP diferente de 200 ou JSON fora do formato lança", async () => {
  // page-2 → 500: await expect(collect(...)).rejects.toThrow(/RemoteJobs/)
  // page-2 → { lixo: true }: idem
});
it("normalize decodifica entidades, usa a URL do remotejobs.org e mapeia campos", () => {
  // company sem "&amp;"; url começa com "https://remotejobs.org/remote-jobs/"
  // worldwide → eligibleRegions ["Worldwide"]; restricted ["BR"] → ["Brasil"] (via countryNameFromCode)
  // work_arrangement remote→"remote", hybrid→"hybrid", onsite→"onsite", unknown→null
  // salário anual → { min, max, currency: "USD", period: "year" }; período "week" → salary null
  // tags inclui category.name; descriptionFormat "html"; publishedAt = new Date(posted_at)
});
it("normalize rejeita lixo, host diferente e presencial/híbrida fora do Brasil", () => {
  // normalize({ lixo: true }) === null
  // url "https://empresa.example/x" → null
  // hybrid com worksite_countries ["SG"] → null; hybrid com ["BR"] → não nulo
});
```

- [ ] **Passo 3: rodar e ver falhar**

Run: `pnpm vitest run tests/unit/server/sources/remotejobs.test.ts`
Esperado: FAIL (módulo `@/lib/server/sources/remotejobs` inexistente).

- [ ] **Passo 4: catálogo e registry**

`lib/shared/sources.ts`: `{ id: "remotejobs", label: "RemoteJobs.org", trust: 2 }` no fim de `SOURCES`. `registry.ts`: importar `remotejobs` e incluir no `CONNECTORS`. `tests/unit/shared/sources.test.ts`: `SOURCE_IDS.length` vira `16`.

- [ ] **Passo 5: implementar `lib/server/sources/remotejobs.ts`**

- `jobSchema` conforme a D-02 da spec (`id`, `title`, `url`, `company.name` obrigatórios; o resto `nullish`). `pageSchema = z.object({ data: z.array(z.unknown()), pagination: z.object({ has_more: z.boolean() }) })`.
- `fetch`: gerador `async function*` com `offset` de 0 a 29×50; antes de cada página, se `Date.now() >= ctx.deadlineAt - 5_000` → `ctx.reportPartial("remotejobs", new Error("prazo da fonte esgotado"))` e retorna; `ctx.signal.throwIfAborted()`; status ≠ 200 → `throw new Error(\`RemoteJobs.org respondeu ${status}\`)`; schema inválido → `throw new Error("RemoteJobs.org: resposta fora do formato esperado")`; `Set` de ids para descartar repetidos; para quando `has_more` é false ou `data` vem vazio; ao sair do laço pelo teto com `has_more` true → `reportPartial("remotejobs", new Error("teto de 30 páginas atingido"))`.
- `normalize`: mapeamento da D-02. Período de salário aceito: `hour|month|year`. `country` = único `worksite_countries` quando houver só um. Descarte de `onsite`/`hybrid` sem `BR` em `worksite_countries`.

- [ ] **Passo 6: rodar e ver passar**

Run: `pnpm vitest run tests/unit/server/sources/remotejobs.test.ts tests/unit/shared/sources.test.ts`
Esperado: PASS.

- [ ] **Passo 7: contrato e docs**

Adicionar em `tests/contract/sources.contract.test.ts`:

```ts
it("remotejobs: payload real bate com o schema do conector", { timeout: TEST_TIMEOUT_MS }, async () => {
  await expectSource("remotejobs", remotejobsJob);
});
```

Run: `pnpm test:contract -t remotejobs` → PASS (usa a rede; cerca de 11 requisições).

Em `docs/fontes.md`, linha da tabela com: endpoint acima; termos [/terms](https://remotejobs.org/terms) e [developers](https://remotejobs.org/developers) checados em 2026-11-25 (API livre, sem chave; crédito visível e links intactos; não burlar limites); atribuição "RemoteJobs.org" sem dofollow; `fullSnapshot: true`; limites (200 req/h por IP, 542 vagas `country=BR` em 2026-11-25 = 11 páginas, teto de 30 páginas com falha parcial, aviso de duplicação com ATS). Incluir `REMOTEJOBS_HOST` na frase dos hosts.

- [ ] **Passo 8: verificação**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Esperado: tudo verde.

- [ ] **Passo 9: commit (só com autorização)**

```bash
git add lib/server/sources/remotejobs.ts lib/shared/sources.ts lib/server/sources/registry.ts tests/fixtures/sources/remotejobs tests/unit/server/sources/remotejobs.test.ts tests/unit/shared/sources.test.ts tests/contract/sources.contract.test.ts docs/fontes.md
git commit -m "feat(fontes): conector RemoteJobs.org"
```

### Task 2: "Fontes" no header

**Arquivos:**
- Modificar: `components/layout/nav.ts:6-11` (`PRIMARY_NAV`)
- Modificar: `components/layout/SiteHeader.tsx` (link compacto no celular)
- Modificar: `components/layout/SiteFooter.tsx:12-14` (remover o link)
- Modificar: `tests/unit/client/site-header.test.tsx`

**Interfaces:**
- Consome: `NavLink`, `PRIMARY_NAV`, `NavId` (já incluem `"fontes"`); ícone `Radar` de `lucide-react` (o mesmo da folha "Mais").
- Produz: nada usado por outras tarefas. Independente da Tarefa 1.

- [ ] **Passo 1: ajustar os testes (falham)** em `tests/unit/client/site-header.test.tsx`

```ts
// no teste existente do menu principal, a lista vira:
["Vagas", "Fontes", "Minhas vagas", "Perfil", "Configurações"]

it("mostra Fontes no header do celular, fora do menu principal", () => {
  render(<SiteHeader />);
  const nav = screen.getByRole("navigation", { name: "Principal" });
  const mobile = screen.getAllByRole("link", { name: "Fontes" }).find((l) => !nav.contains(l))!;
  expect(mobile.getAttribute("href")).toBe("/fontes");
  expect(mobile.className).toContain("md:hidden");
  expect(mobile.className).toContain("min-h-11");
});

it("destaca Fontes na página de fontes", () => {
  render(<SiteHeader current="fontes" />);
  for (const link of screen.getAllByRole("link", { name: "Fontes" })) expect(link.getAttribute("aria-current")).toBe("page");
});

// no teste do rodapé: a lista vira ["Privacidade", "Apoie o projeto", "Código no GitHub"]
// e expect(within(footer).queryByRole("link", { name: "Fontes" })).toBeNull();
```

- [ ] **Passo 2: rodar e ver falhar**

Run: `pnpm vitest run tests/unit/client/site-header.test.tsx`
Esperado: FAIL nos três casos novos/alterados.

- [ ] **Passo 3: implementar**

- `nav.ts`: `{ id: "fontes", label: "Fontes", href: "/fontes" }` logo depois de "Vagas" em `PRIMARY_NAV` (o `MORE_NAV` fica como está).
- `SiteHeader.tsx`: antes do `ThemeToggle`, um `Link` para `/fontes` com `aria-current={current === "fontes" ? "page" : undefined}`, classes `ml-auto inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold md:hidden` (cor `text-jf-brand` quando atual, `text-jf-ink-2` caso contrário), `<Radar aria-hidden="true" className="size-[18px]" />` + texto "Fontes". Trocar o `ml-auto` do `ThemeToggle` para `md:ml-0` apenas (o link compacto passa a empurrar os itens à direita no celular).
- `SiteFooter.tsx`: remover o `Link` "Fontes".

- [ ] **Passo 4: rodar e ver passar**

Run: `pnpm vitest run tests/unit/client/site-header.test.tsx tests/unit/client/mobile-tab-bar.test.tsx tests/unit/client/donation.test.tsx`
Esperado: PASS.

- [ ] **Passo 5: verificação visual**

Subir o preview e conferir `/` e `/fontes` em desktop (item "Fontes" no menu, destacado em `/fontes`, rodapé sem o link) e em `resize_window` preset `mobile` (link "Fontes" ao lado do tema, alvo de 44 px, sem quebra de linha no header de 56 px). Rodar `pnpm typecheck && pnpm lint && pnpm test`.

- [ ] **Passo 6: commit (só com autorização)**

```bash
git add components/layout/nav.ts components/layout/SiteHeader.tsx components/layout/SiteFooter.tsx tests/unit/client/site-header.test.tsx
git commit -m "feat(ui): Fontes no header do desktop e do celular"
```

## Paralelismo

As tarefas 1 e 2 tocam arquivos disjuntos e não dependem uma da outra: podem rodar em paralelo. Verificação final: `pnpm typecheck && pnpm lint && pnpm test` e `pnpm test:e2e tests/e2e/sources.spec.ts` (a página `/fontes` lista o catálogo; a nova fonte deve aparecer sem ajuste, conferir).
