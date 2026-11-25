# Auditoria da inserção de vagas e CRON de limpeza (60 dias)

- **Data:** 2026-11-25
- **Origem:** pedido direto (sem PRD). Requisitos registrados como premissas abaixo.
- **Spec base:** [docs/tech/2026-11-23-job-find-agregador-vagas-tech.md](2026-11-23-job-find-agregador-vagas-tech.md) (D-04: modelo de dados, deduplicação, expiração e retenção)
- **Status:** implementada na branch fix/limpeza-vagas-linkedin (2026-11-25)

## 1. Requisitos (premissas)

| ID | Requisito |
|---|---|
| RQ-01 | Confirmar se a inserção de vagas gera duplicatas. |
| RQ-02 | Confirmar se a inserção está correta (dados, concorrência, falhas). |
| RQ-03 | Confirmar se o banco está crescendo sem controle. |
| RQ-04 | Uma CRON que apaga as vagas com mais de 60 dias. |

**Limite desta auditoria:** a análise foi feita no código. O banco de produção (Neon) não foi consultado, e o Postgres local não estava de pé. Os números reais saem das consultas da seção 5, que devem ser rodadas em produção antes e depois da mudança.

## 2. Como a inserção funciona hoje

Fluxo: `GET /api/cron/collect` (Vercel Schedules, minuto 17 de cada hora) → `runCollection` → `runSource` por fonte (15 conectores, 5 em paralelo, lock por fonte) → `processBatch` em lotes de 100 dentro de uma transação → `upsertJob` com savepoint por vaga.

- **Atalho por hash** (`lib/server/collect/run.ts:683-692`): vaga já conhecida, ativa, com o mesmo `content_hash` e a mesma URL só renova `last_seen_at` num UPDATE por lote. Não reescreve `jobs`.
- **Resolução da vaga existente** (`lib/server/jobs/upsert.ts:181-216`), em três níveis:
  1. `(source, external_id)` em `job_sources`;
  2. `url_canonical` entre as ativas;
  3. `dedupe_key` (sha1 de empresa + título + país + cidade + modelo de trabalho, normalizados) entre as ativas, com janela de 30 dias.
- **Garantia no banco** (`drizzle/0000_init.sql`, `lib/server/db/schema.ts:78-79`): índices únicos parciais em `dedupe_key` e em `url_canonical`, ambos `WHERE expired_at IS NULL`. `job_sources` tem PK `(source, external_id)`.
- **Expiração** (`lib/server/jobs/expire.ts:424-446`): a cada coleta, marca `expired_at` em vagas com `published_at` acima de 45 dias ou com 3 coletas perdidas em todas as fontes.
- **Retenção** (`lib/server/jobs/expire.ts:449-456`, `lib/server/collect/run.ts:933`): `DELETE` das vagas expiradas há mais de 30 dias, só na execução da coleta das 03:17 UTC.

## 3. Achados

### O que está correto

- **Duplicata exata entre vagas ativas é impossível.** O banco recusa duas linhas ativas com a mesma `dedupe_key` ou a mesma `url_canonical`. Uma fonte nunca gera duas linhas para o mesmo `external_id` (PK).
- **Concorrência entre fontes na mesma chave** é tratada pelo `ON CONFLICT (dedupe_key) WHERE expired_at IS NULL` (`upsert.ts:310-320`).
- **Falha isolada:** o savepoint por vaga (`run.ts:697`) desfaz só a vaga com erro; o lote e a fonte seguem.
- **Escrita mínima:** a linha de `jobs` só é reescrita quando o conteúdo muda ou entra uma fonte nova. `job_sources` usa `fillfactor = 85`, o que favorece updates HOT (sem inchar índices).
- **Vaga velha não entra:** vaga nova com mais de 45 dias é descartada antes do INSERT (`upsert.ts:229-235`).
- **Prioridade de fonte:** uma fonte menos confiável não sobrescreve o conteúdo vindo do ATS da empresa (`upsert.ts:218-225`).

### Problemas

| # | Severidade | Achado | Evidência |
|---|---|---|---|
| A-01 | Média | **Vagas expiradas são peso morto.** Nenhuma leitura usa vaga expirada: a listagem e o detalhe filtram `expired_at IS NULL`, e o upsert também ignora. Mesmo assim elas ficam 30 dias no banco, com a descrição de até 30 KB. Uma vaga vive até ~75 dias (45 até expirar + 30 de retenção). | `lib/server/jobs/query.ts:78`, `query.ts:186`, `upsert.ts:189` |
| A-02 | Média | **`source_runs` nunca é apagada.** São 15 fontes × 24 coletas = ~360 linhas por dia, ~130 mil por ano, sem limite. Linhas presas em `running` (função morta no meio) também ficam para sempre. A página de status faz `DISTINCT ON` nessa tabela inteira. | `lib/server/collect/run.ts:281`, `lib/server/sources/status.ts:15` |
| A-03 | Média | **A retenção depende da coleta das 03:17.** Se essa execução não acontecer, estourar o budget ou se `expireJobs` lançar erro (mesmo `try`), a limpeza do dia é pulada em silêncio. | `run.ts:931-936` |
| A-04 | Média (medir) | **Duplicata visível entre fontes.** A `dedupe_key` inclui cidade e modelo de trabalho. A mesma vaga vinda do ATS ("São Paulo", `hybrid`) e de um agregador (cidade nula, `unknown`) gera chaves e URLs diferentes, e aparece duas vezes. O banco não tem como impedir; precisa ser medido (consulta 5.3). | `lib/server/enrich/dedupe.ts:465-475` |
| A-05 | Baixa | **Conflito de URL não tratado no INSERT.** O `ON CONFLICT` cobre só `dedupe_key`. Duas fontes gravando ao mesmo tempo a mesma URL com chaves diferentes geram erro 23505: a vaga conta como erro e entra na coleta seguinte. Se corrige sozinho. | `upsert.ts:297-321` |
| A-06 | Baixa | **A janela de 30 dias troca o id da vaga.** Quando outra fonte traz a mesma chave de uma vaga vista há mais de 30 dias, a antiga é expirada e nasce uma linha nova com outro id. Isso deixa uma linha morta e quebra o link salvo em "Minhas vagas" (o detalhe responde 404). | `upsert.ts:210-211`, `app/api/jobs/[id]/route.ts` |

**Veredito:** a inserção está correta e não gera duplicata exata. O crescimento vem da retenção de linhas que ninguém lê (A-01), de um log sem limpeza (A-02) e de uma limpeza frágil (A-03). A-04 é o único risco de duplicata que o usuário vê, e precisa de medição antes de qualquer mudança.

## 4. Decisões

### D-01: CRON própria de limpeza, separada da coleta

- **Contexto:** RQ-04 e A-03. Hoje a retenção é um efeito colateral da coleta das 03:17.
- **Opções:**
  1. Manter dentro da coleta e só mudar a regra. Barato, mas segue frágil (A-03).
  2. **Nova rota `/api/cron/purge` com agendamento diário próprio no `vercel.json`.**
  3. `pg_cron` no Neon. Fica fora do repositório, sem teste e sem log no projeto.
- **Decisão:** opção 2. Agendamento `"37 4 * * *"` (UTC, longe do minuto 17 da coleta), método GET, mesma autenticação `verifyCronSecret` com o `CRON_SECRET` que já existe. Nenhuma variável de ambiente ou flag nova. A chamada a `purgeExpired` sai de `runCollection` (e a constante `PURGE_HOUR_UTC`).
- **Consequências:** a limpeza roda mesmo se a coleta falhar. O Vercel Schedules aceita vários agendamentos no `vercel.json` (docs: *Schedules → Configuration*). **Premissa:** o limite de agendamentos por time do Hobby comporta 2.

### D-02: Regras de exclusão

Tudo dentro de `lib/server/jobs/expire.ts`, numa função `purgeOld(db, now)` que substitui `purgeExpired`:

| Regra | Alvo | Por quê |
|---|---|---|
| R-1 | `jobs` com `published_at < now - 60 dias` | RQ-04. Usa a mesma data da regra dos 45 dias e do "publicada há X dias" da interface. Uma vaga ativa já expira aos 45, então esta regra **nunca apaga vaga visível**. |
| R-2 | `jobs` com `expired_at < now - 30 dias` | Regra atual mantida (decisão do Jaymes em 2026-11-25). Com a R-1, a vida máxima de uma linha cai de ~75 para 60 dias. |
| R-3 | `source_runs` com `started_at < now - 30 dias` | A-02. A coleta só consulta o ciclo da fonte + 2 h (`coveredCycle`) e a última coleta ok; 30 dias sobram para diagnóstico. |

- `job_sources` sai junto, pelo `ON DELETE CASCADE` que já existe.
- **Exclusão em lotes:** `DELETE ... WHERE id IN (SELECT id ... LIMIT 2000)` em laço até apagar menos que o lote ou estourar 50 s. Evita uma transação longa no primeiro run, que vai apagar o acumulado.
- **Sem invalidação de cache:** as linhas apagadas já não aparecem em nenhuma leitura.
- **Resposta da rota:** `200 { jobs, sourceRuns }` com as contagens, e o mesmo resumo no log.
- **Descartado:** medir a idade por `first_seen_at`. Ele é reiniciado quando a vaga renasce (A-06) e não bate com a data que o usuário vê.

### D-03: Diagnóstico antes e depois (seção 5)

- **Decisão:** as consultas da seção 5 rodam em produção antes do deploy (linha de base) e uma semana depois. Ficam versionadas em `scripts/db-audit.sql`, só com SELECT.
- **Por quê:** a auditoria foi feita no código; tamanho real e taxa de duplicata entre fontes (A-04) só se veem no banco.

### D-04: A-04 a A-06 ficam fora desta entrega

- **A-04:** decidir depois da consulta 5.3. Se a taxa de duplicata entre fontes for relevante, a correção provável é tirar cidade e modelo de trabalho da chave quando um dos lados vier nulo/`unknown`. Isso muda a semântica da RN-05 e merece spec própria.
- **A-05:** se corrige sozinho na coleta seguinte; não vale a complexidade agora.
- **A-06:** efeito colateral aceito da RN-05; registrado.

### Eixos sem impacto

APIs públicas, front/UX, integrações externas, segurança além da autenticação do cron já existente (reaproveitada), modelo de dados (nenhuma coluna ou índice novo; a R-1 faz varredura sequencial numa tabela de dezenas de milhares de linhas, uma vez por dia).

## 5. Consultas de diagnóstico (somente leitura)

```sql
-- 5.1 Tamanho por tabela (dados + índices + TOAST)
SELECT relname, n_live_tup, n_dead_tup,
       pg_size_pretty(pg_total_relation_size(relid)) AS total
FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC;

-- 5.2 Vagas por estado e idade
SELECT (expired_at IS NULL) AS ativa,
       count(*) AS vagas,
       count(*) FILTER (WHERE published_at < now() - interval '60 days') AS mais_60d,
       count(*) FILTER (WHERE expired_at < now() - interval '30 days') AS expirada_30d,
       pg_size_pretty(sum(pg_column_size(description_html))::bigint) AS descricoes
FROM jobs GROUP BY 1;

-- 5.3 Duplicata provável entre fontes (mesma empresa + título, chaves diferentes)
SELECT lower(unaccent(company)) AS empresa, lower(unaccent(title)) AS titulo,
       count(*) AS linhas, array_agg(DISTINCT city) AS cidades,
       array_agg(DISTINCT work_mode) AS modos, array_agg(id) AS ids
FROM jobs WHERE expired_at IS NULL
GROUP BY 1, 2 HAVING count(*) > 1 ORDER BY linhas DESC LIMIT 50;

-- 5.4 Integridade: deve voltar tudo zero
SELECT
  (SELECT count(*) FROM (SELECT dedupe_key FROM jobs WHERE expired_at IS NULL GROUP BY 1 HAVING count(*) > 1) d) AS chave_dup,
  (SELECT count(*) FROM (SELECT url_canonical FROM jobs WHERE expired_at IS NULL GROUP BY 1 HAVING count(*) > 1) u) AS url_dup,
  (SELECT count(*) FROM jobs j WHERE expired_at IS NULL AND NOT EXISTS (SELECT 1 FROM job_sources s WHERE s.job_id = j.id)) AS ativa_sem_fonte,
  (SELECT count(*) FROM jobs WHERE expired_at IS NULL AND published_at < now() - interval '45 days') AS ativa_vencida;

-- 5.5 Log de coletas
SELECT count(*) AS linhas, min(started_at) AS mais_antiga,
       count(*) FILTER (WHERE status = 'running' AND started_at < now() - interval '1 hour') AS presas
FROM source_runs;
```

## 6. Plano de entrega

### Fase 1: CRON de limpeza (resolve RQ-03, RQ-04, A-01 a A-03). Esforço M

| Tarefa | Arquivos | Pronto quando |
|---|---|---|
| T1. `purgeOld` com R-1, R-2 e R-3 em lotes (substitui `purgeExpired`; `RETENTION_DAYS` segue 30) | `lib/server/jobs/expire.ts` | Testes de integração: apaga >60 dias (ativa ou não), expirada >30 dias, `source_runs` >30 dias, cascata em `job_sources`; preserva vaga ativa recente e expirada recente; laço de lotes termina |
| T2. Rota `app/api/cron/purge/route.ts` (401 sem segredo, 200 com contagens, `maxDuration` 60) | rota nova | Teste unitário no molde de `tests/unit/server/cron-route.test.ts` |
| T3. Tirar a retenção de `runCollection` | `lib/server/collect/run.ts`, `tests/integration/collect/run.test.ts` | Teste do spy de `purgeExpired` às 03h removido/ajustado |
| T4. Agendamento `purge` | `vercel.json` | `pnpm build` ok |
| T5. Documentação | D-04 da spec base (retenção), `README`/`CONTRIBUTING` se citarem a retenção | Texto bate com o código |

T1 e T4 são independentes; T2 e T3 dependem de T1. Verificação: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration` (com `pnpm db:test:up`) e `pnpm build`.

### Fase 2: Diagnóstico em produção. Esforço P

- `scripts/db-audit.sql` com a seção 5.
- Rodar antes do deploy e 7 dias depois; registrar os números neste documento.
- Com o resultado da 5.3, decidir se A-04 vira spec própria.

## 7. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Primeira execução apaga muito de uma vez | Média | Baixo | Lotes de 2000 com teto de tempo; o restante sai no dia seguinte |
| Limite de agendamentos do Hobby não comporta o segundo | Baixa | Médio | Plano B: a coleta chama `purgeOld` em toda execução (é barata e idempotente), o que já resolve A-03 |
| Expiração errada vira perda definitiva em 30 dias | Baixa | Baixo | A vaga volta na coleta seguinte se ainda existir na fonte (linha nova) |
| Espaço não volta para o disco após o DELETE | Alta | Baixo | O autovacuum libera o espaço para reuso; o banco para de crescer. `VACUUM FULL` não é necessário nesse volume |

## 8. Perguntas em aberto

1. ~~Retenção das expiradas em 7 dias~~: decidido manter 30 dias.
2. 30 dias de histórico em `source_runs` bastam para a página de fontes e para diagnóstico?

## 9. Adendo: coleta do LinkedIn (Apify)

Pedido de 2026-11-25: conferir se a coleta do LinkedIn está correta, se pega as vagas das últimas 24 h e grava no banco, e se roda a cada 2 h aproveitando os US$ 5/mês do Apify.

### Como funciona hoje (`lib/server/sources/linkedin.ts`)

A coleta horária (minuto 17) chama o conector, que: (1) lista as 10 últimas execuções do actor `valig/linkedin-jobs-scraper`; (2) ingere o dataset da última execução `SUCCEEDED`, uma vez só (cursor = id do dataset); (3) inicia uma nova execução se a última começou há `RUN_EVERY_HOURS` ou mais e nenhuma está em andamento. Entrada da execução: uma palavra-chave por vez (rodízio de 8), `location: "Brazil"`, `datePosted: "r86400"` (últimas 24 h), até 200 vagas, teto de US$ 0,08.

### Evidências em produção

- `APIFY_TOKEN` está configurado em produção e preview (Vercel, verificado sem ler o valor).
- Log da coleta de 2026-11-25 10:21 UTC: `linkedin:ok +0 ~0 =0`. Com execução a cada 12 h, 11 de cada 12 coletas não têm dataset novo, então esse zero é esperado e não prova nem falha nem sucesso. O Hobby guarda só 1 h de log; a prova está em `source_runs` (consulta 9.1) e no console do Apify.

### Achados

| # | Severidade | Achado | Evidência |
|---|---|---|---|
| L-01 | Alta | **Roda a cada 12 h, não a cada 2 h.** `RUN_EVERY_HOURS = 12`, 200 vagas por execução (~US$ 4,80/mês). | `linkedin.ts:23-27` |
| L-02 | Alta | **A janela de 24 h não cobre as buscas.** São 8 palavras-chave em rodízio, uma por execução. Com 12 h, cada palavra é buscada a cada 4 dias, mas só pega as vagas das últimas 24 h: em 3 de cada 4 dias, as vagas daquela busca nunca entram. | `linkedin.ts:30-39`, `keywordFor` |
| L-03 | Alta | **Falha ao iniciar a execução descarta as vagas já baixadas.** O POST que inicia a próxima execução vem depois dos `yield` do dataset. Se ele falhar (ex.: crédito do mês acabou, 402/403, timeout), o gerador lança erro, a coleta cai no `catch` e o último lote (< 100 vagas, ou seja, todas com o volume atual) não é gravado, nem o cursor. Na hora seguinte o mesmo dataset é baixado e perdido de novo, enquanto o POST falhar. | `linkedin.ts:96-110`, `collect/run.ts:794-803` (o lote final só é gravado depois do laço) |
| L-04 | Média | **Só o último dataset é ingerido.** Se uma coleta falhar ou for pulada e duas execuções terminarem nesse meio-tempo, o dataset da mais antiga nunca entra. Com 2 h de cadência isso fica mais provável. | `linkedin.ts:87` (`items.find` pega só o primeiro `SUCCEEDED`) |
| L-05 | Baixa | **Sem token, a fonte fica `ok` com zero vagas.** Um token apagado ou expirado (401 dá erro, mas ausente não) passa despercebido na página de fontes. | `linkedin.ts:78-79` |
| L-06 | Baixa (verificar) | **A busca não pede ordenação por data.** O LinkedIn ordena por relevância; com um teto pequeno por execução, as mais recentes podem ficar de fora. O actor aceita `urlParam`, mas a ordenação (`sortBy=DD`) não está documentada nele. | Página do actor, lida em 2026-11-25 |

**Gravação no banco:** quando o dataset é ingerido, as vagas passam pelo mesmo `processBatch`/`upsertJob` das outras fontes (seção 2), com `external_id` = id da vaga no LinkedIn; reingestão não duplica.

### D-05: Cadência de 2 h dentro dos US$ 5

- **Contexto:** o actor cobra por evento (US$ 0,40 por 1.000 vagas na página; "a partir de US$ 0,28" com desconto) e o Free bloqueia, sem cobrar, quando o crédito acaba. O que o orçamento limita é o **número de vagas por mês** (~12.000), não o número de execuções.
- **Decisão:**
  - `RUN_EVERY_HOURS = 2` → 12 execuções/dia, ~372/mês.
  - `RESULTS_PER_RUN = 32` e `MAX_CHARGE_PER_RUN_USD = 0.013`. Teto do mês: 372 × US$ 0,013 = **US$ 4,84**, mesmo que o actor cobre um evento de início (o `maxTotalChargeUsd` limita tudo o que a execução cobra).
  - O rodízio de 8 palavras passa a repetir cada uma a cada 16 h, dentro da janela de 24 h: **nenhum dia fica sem cobertura** (resolve L-02).
- A checagem "está na hora" aceita 30 min de tolerância (`DUE_TOLERANCE_MS`): o `startedAt` da execução anterior é o instante do POST, minutos depois do início da coleta, e sem folga a cadência escorregaria para 3 h. Com cron de hora em hora, qualquer tolerância abaixo de 1 h nunca inicia execuções em horas seguidas.
- **Consequência honesta:** o volume total continua ~400 vagas/dia (é o que US$ 5 compram). O ganho é cobertura de todas as buscas todo dia e vagas mais frescas (entram até ~3 h depois de publicadas, contra até 4 dias hoje).
- **Descartado:** reduzir a janela para 2 h (`f_TPR=r7200`): com o rodízio, cada palavra só seria vista em 1/8 das janelas.

### D-06: Correções de robustez

- **L-03:** o POST de início vira tolerante a falha: erro dele vai para `ctx.reportPartial("apify:start", e)` e a coleta segue `ok`, gravando o dataset e o cursor.
- **L-04:** ingerir, do mais antigo para o mais novo, todas as execuções `SUCCEEDED` da lista que vierem depois da execução do cursor (se o cursor não estiver entre as 10, ingere todas: o upsert é idempotente). O cursor fica no dataset mais novo ingerido.
- **L-05:** sem token, `console.warn` uma vez por processo (não vira erro, para não quebrar quem roda o projeto sem Apify).
- **L-06:** fora desta entrega; testar `urlParam` de ordenação numa execução manual antes de adotar.

### 9.1 Consultas (somente leitura)

```sql
-- Últimas coletas do LinkedIn: espere fetched_count > 0 a cada 2 h depois da mudança
SELECT started_at, status, fetched_count, new_count, updated_count, error
FROM source_runs WHERE source = 'linkedin' ORDER BY started_at DESC LIMIT 30;

-- Vagas do LinkedIn por dia de entrada
SELECT date_trunc('day', s.first_seen_at) AS dia, count(*)
FROM job_sources s WHERE s.source = 'linkedin' GROUP BY 1 ORDER BY 1 DESC LIMIT 14;
```

### Fase 3: LinkedIn. Esforço P/M

| Tarefa | Arquivos | Pronto quando |
|---|---|---|
| T6. Constantes de cadência e orçamento (D-05) | `lib/server/sources/linkedin.ts`, `docs/fontes.md`, `.env.example` (texto) | Teste: nova execução só depois de 2 h; `maxItems=32` e `maxTotalChargeUsd=0.013` no POST; `keywordFor` muda a cada 2 h |
| T7. POST tolerante a falha (L-03) | `linkedin.ts` | Teste: POST com 402 → itens do dataset entregues, cursor gravado, `reportPartial` chamado |
| T8. Ingerir todas as execuções novas (L-04) | `linkedin.ts`, `tests/fixtures/sources/linkedin/runs.json` | Teste: duas `SUCCEEDED` depois do cursor → dois datasets, na ordem, cursor no mais novo |
| T9. Aviso sem token (L-05) | `linkedin.ts` | Teste do `console.warn` |

Independente das fases 1 e 2 (arquivos diferentes); pode rodar em paralelo.
