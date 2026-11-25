# Spec técnica: fonte RemoteJobs.org e "Fontes" no header

- **Data:** 2026-11-25
- **Origem:** pedido do mantenedor na conversa (sem PRD dedicado). Requisitos registrados como premissas abaixo; regras herdadas do PRD base (`docs/prd/2026-11-23-job-find-agregador-vagas-tech.md`: RN-01 filtro tech, RN-09 termos das fontes) e do catálogo `docs/fontes.md`.
- **Tamanho:** pequeno (1 conector + 1 ajuste de navegação). Não houve convocação de especialistas em paralelo: a mudança segue um padrão que já se repete 15 vezes no código.

## Requisitos (premissas)

| ID | Requisito |
|---|---|
| RF-01 | Coletar vagas do RemoteJobs.org de hora em hora, como as demais fontes, e exibi-las com crédito à fonte. |
| RF-02 | "Fontes" aparece no menu do header (desktop), não só no rodapé e na folha "Mais". |
| RNF-01 | Serviço gratuito para o uso real do projeto (regra do mantenedor). |
| RNF-02 | Respeitar termos, robots e limites da fonte (RN-09). |
| RNF-03 | Nenhuma variável de ambiente ou feature flag nova; a fonte entra já ativa. |

## Verificação da fonte (2026-11-25)

Fatos checados ao vivo (curl e leitura das páginas):

- **API:** `GET https://remotejobs.org/api/v1/jobs` ([docs](https://remotejobs.org/developers/api)). JSON, sem chave, sem cadastro. Paginação por `limit` (1 a 50) e `offset`, com `pagination.{total, has_more}`. Filtros úteis: `country` (ISO-2), `category`, `sort=recent`, `eligibility` (`known` por padrão; `possible` inclui evidência geográfica incerta).
- **Gratuidade (RNF-01):** "Free access. No signup. No API key." Os produtos pagos (anúncio de vaga, Career Agent) são à parte. ✅
- **Limite:** 200 requisições/h por IP, best-effort; cabeçalhos `X-RateLimit-*` confirmados na resposta, 429 com `Retry-After`.
- **Termos** ([/terms](https://remotejobs.org/terms), atualizados em 24/10/2026): usar a API "according to the documented access requirements, attribution requirements, and limits"; proíbe burlar controles de acesso ou rate limit; não há cláusula contra coleta automatizada nem contra uso comercial. A página de [developers](https://remotejobs.org/developers) pede manter os links das vagas intactos e exibir crédito visível ao RemoteJobs.org.
- **Robots:** `Allow: /`; nada bloqueia `/api/`.
- **Volume medido:** `country=BR` (elegibilidade `known`) = **542 vagas** no total, em todas as categorias (40 de 50 numa amostra são `worldwide`); `category=programming&country=BR` = 120. Com `eligibility=possible` sobe para 7.633 (ruído demais, descartado).
- **Qualidade do dado:** `company.name` vem com entidades HTML (`&amp;`); `url` e `apply_url` apontam para a página da vaga no próprio remotejobs.org; `description` é HTML sanitizado com um link de candidatura do RemoteJobs.org no fim; salário é raro (8 de 50); não há array de tags (só `category` e `search_facts.required_skills`, quase sempre vazio). Numa amostra, o nome da empresa não batia com a descrição (o próprio site agrega de terceiros).

## Decisões

### D-01. Consulta: `country=BR` em todas as categorias, snapshot completo

- **Opções:** (a) `country=BR` sem categoria, lendo todas as páginas; (b) uma consulta por categoria tech (`programming`, `devops`, `data-science`, `quality-assurance`...); (c) `eligibility=possible` para ampliar.
- **Decisão:** (a). 542 vagas = 11 páginas de 50 por coleta, 11 req/h, bem abaixo das 200/h. O filtro RN-01 (`isTechJob`, já aplicado depois do `normalize`) descarta vendas, RH etc. Uma consulta só é mais simples que N categorias e não perde vagas tech mal categorizadas (`general`).
- **Consequência:** como a lista inteira é relida a cada hora, a fonte declara `fullSnapshot: true` e a vaga que some expira em 3 coletas perdidas (regra do runner).
- **Guardas do snapshot:** teto de 30 páginas (1.500 vagas). Se o teto for atingido com `has_more: true`, ou se o prazo da fonte (`deadlineAt`) acabar no meio, o conector chama `ctx.reportPartial(...)`, e o runner não conta coleta perdida nessa execução (não expira vagas por lista incompleta). Página com status ≠ 200 ou fora do schema derruba a coleta (lança erro), como no Jobicy.
- **Paginação com `sort=recent`:** vaga nova publicada durante a leitura empurra os itens e pode repetir um na virada de página; ids repetidos são descartados com um `Set` (mesmo padrão do Jobicy/WWR). O risco inverso (pular um item) só atrasa a vaga uma hora; com `fullSnapshot`, um pulo isolado não expira nada (exige 3 coletas perdidas seguidas).

### D-02. Conector `lib/server/sources/remotejobs.ts`

Segue o molde de `jobicy.ts`/`remoteok.ts`:

- `id: "remotejobs"`, `brazilian: false`, `fullSnapshot: true`, `minIntervalMinutes: 60`, `allowedHosts: [REMOTEJOBS_HOST]` (`remotejobs.org`), sem `maxResponseBytes` (página de 50 ≈ 440 KB).
- `attribution: { label: "RemoteJobs.org", url: "https://remotejobs.org", dofollow: false }`. Os termos pedem crédito visível, não dofollow; o crédito sai no `JobDetail` como nas demais fontes.
- **Schema zod** (`jobSchema`, exportado para o teste de contrato): `id` (uuid string), `title`, `url`, `company.{name, logo_url}`, `category.slug`, `location`, `location_normalization.{work_arrangement, scope, allowed_countries, worksite_countries}`, `salary_{min,max,currency,period}`, `search_facts.{seniority, required_skills}`, `description`, `posted_at`. Tudo opcional/`nullish` exceto `id`, `title`, `url`, `company.name`.
- **Mapeamento:**
  - `externalId` = `id`; `url` = `url` validada com `safeUrl` e host exatamente `remotejobs.org` (link intacto, exigência dos termos); vaga com outro host é descartada.
  - `company` = `decodeEntities(company.name)` (`lib/server/sources/text.ts`); `companyLogoUrl` = `safeUrl(logo_url)`.
  - `title` também passa por `decodeEntities`.
  - `workModeHint`: `remote` → `remote`, `hybrid` → `hybrid`, `onsite` → `onsite`, `unknown`/ausente → `null`.
  - `eligibleRegions`: `scope === "worldwide"` → `["Worldwide"]`; senão os nomes dos `allowed_countries` (ISO-2 → nome via helper de `location.ts`). `country` = o único país de `worksite_countries` quando houver só um.
  - `locationText` = `location`; `city` = `null`.
  - `seniorityHint` a partir de `search_facts.seniority` (quando vier), `null` caso contrário.
  - `tags` = `[category.name, ...required_skills]`, sem vazios.
  - `salary` só quando houver moeda, período reconhecido (`hour|month|year`; `day`/`week` → descartado) e pelo menos um valor > 0.
  - `descriptionHtml` = `description`, `descriptionFormat: "html"` (o sanitizador do projeto já trata o HTML; o link de candidatura no fim aponta para o próprio RemoteJobs.org e é aceitável).
- **Filtro de localidade:** a consulta já devolve só vagas com elegibilidade conhecida para o Brasil; por defesa, `onsite`/`hybrid` cujo `worksite_countries` não inclua `BR` é descartada no `normalize` (evita a vaga híbrida em Singapura vista na amostra sem filtro).

### D-03. Catálogo e registro

- `lib/shared/sources.ts`: `{ id: "remotejobs", label: "RemoteJobs.org", trust: 2 }` (agregador). O tipo `SourceId`, o schema da API, o filtro "Fonte" e o parser da URL derivam daí.
- `lib/server/sources/registry.ts`: adicionar `remotejobs` ao `CONNECTORS` (o TypeScript acusa se faltar).
- **Banco:** sem migração. `source` é `text` com `$type<SourceId>()` (`lib/server/db/schema.ts:94-125`).
- `docs/fontes.md`: nova linha na tabela (endpoint, termos com link e data 2026-11-25, atribuição, `fullSnapshot`, limites) e `REMOTEJOBS_HOST` na lista de hosts.
- **Duplicação:** o RemoteJobs.org agrega de ATS (a amostra tinha vaga da Notion). A deduplicação por `dedupe_key` da branch atual funde com a vaga do ATS e mantém a URL da fonte mais confiável (trust 3). Nada a fazer além de registrar.

### D-04. "Fontes" no header

- **Contexto:** hoje `/fontes` só aparece no rodapé (`components/layout/SiteFooter.tsx:12`, visível só a partir de `md`) e na folha "Mais" do celular (`components/layout/MoreSheet.tsx:88`). O header desktop renderiza `PRIMARY_NAV` (`components/layout/nav.ts:6`), usado só por `SiteHeader.tsx:31`; a barra de abas do celular tem lista própria (`MobileTabBar.tsx:19`).
- **Opções para o desktop:** (a) acrescentar `{ id: "fontes", label: "Fontes", href: "/fontes" }` ao `PRIMARY_NAV`, depois de "Vagas"; (b) link discreto à direita, como o "Apoie".
- **Decisão (desktop):** (a), logo depois de "Vagas" (é a informação sobre de onde as vagas vêm). `NavLink` já marca o item atual via `current`; a página `/fontes` precisa passar `current="fontes"` ao `SiteHeader` (verificar `app/(site)/fontes/page.tsx` e o shell). O link sai do rodapé para não duplicar no desktop.
- **Celular (abaixo de `md`):** o header mostra só logo e tema. Opções: (a) manter só na folha "Mais" (como hoje); (b) link compacto no header do celular (ícone `Radar` + texto "Fontes", alvo de 44 px) ao lado do tema; (c) quinta aba na barra inferior. **Recomendação: (b)**, que atende "mais visível" também no celular sem apertar a barra de abas (4 colunas hoje). O item continua na folha "Mais". **Ponto de decisão do mantenedor** (ver perguntas).

## Eixos sem impacto

APIs internas e contratos (o schema deriva do catálogo), segurança além do fetch seguro já existente (host fixo, timeout, limite de bytes, sem segredo), performance (11 req/h, ~5 MB/h), dados pessoais (nenhum), feature flag (proibido pela regra do projeto; entra ativa).

## Testes

- **Unitário** `tests/unit/server/sources/remotejobs.test.ts` com fixture `tests/fixtures/sources/remotejobs/page-{1,2}.json` (recorte real de 2 páginas, `has_more` true/false): metadados e registro; paginação até `has_more: false`; ids repetidos entre páginas saem uma vez; teto de páginas e prazo chamam `reportPartial`; status ≠ 200 lança; `normalize` decodifica `&amp;`, rejeita host diferente, mapeia work mode/regiões/salário, descarta híbrida fora do Brasil, devolve `null` para lixo.
- **Contrato** (`tests/contract/sources.contract.test.ts`): payload real bate com `jobSchema` (mesmo padrão das outras fontes).
- **Navegação:** teste de componente do `SiteHeader` com o item "Fontes" e `aria-current` em `/fontes`; ajustar testes do rodapé e da `MoreSheet` que contam links; e2e de navegação, se houver um que liste os itens do header.
- **Verificação:** `pnpm typecheck && pnpm lint`, `pnpm test`, contrato da nova fonte, e conferir no navegador o header em desktop e celular.

## Plano em fases

| Fase | Entrega | Esforço |
|---|---|---|
| 1 | Conector RemoteJobs.org + catálogo + registry + testes + `docs/fontes.md` | M |
| 2 | "Fontes" no header (desktop e, conforme decisão, celular) + ajuste do rodapé + testes | P |

As fases são independentes (arquivos disjuntos) e podem rodar em paralelo.

## Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Volume de `country=BR` crescer além de 1.500 | Baixa | Snapshot incompleto, sem expiração | Teto de 30 páginas + `reportPartial`; revisar o teto se aparecer no `source_runs.error` |
| Dados de empresa inconsistentes (agregação de terceiros) | Média | Vaga com empresa errada | Trust 2: na fusão prevalece o ATS; decodificar entidades |
| Rate limit compartilhado por IP na Vercel | Baixa | 429 esporádico | 11 req/h; o fetch seguro já repete em 429 com espera |
| Termos mudarem | Baixa | Fonte fora da regra RN-09 | Data da checagem registrada em `docs/fontes.md` |

## Decisões do mantenedor (2026-11-25)

1. **Celular:** link compacto "Fontes" no header do celular (opção b da D-04), mantendo o item na folha "Mais".
2. **Rodapé:** o link "Fontes" sai do rodapé.
