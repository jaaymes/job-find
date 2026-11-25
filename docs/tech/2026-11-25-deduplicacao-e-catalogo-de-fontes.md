# Deduplicação entre fontes e catálogo único de fontes

- **Data:** 2026-11-25
- **Origem:** sugestão de um usuário no LinkedIn ("chave de deduplicação com empresa, título normalizado e link canônico, e cada fonte atrás de um adapter com a mesma interface"). Sem PRD; requisitos registrados como premissas abaixo.
- **Specs relacionadas:**
  - [2026-11-23-job-find-agregador-vagas-tech.md](2026-11-23-job-find-agregador-vagas-tech.md) (RN-05, modelo de dados, upsert)
  - [2026-11-25-auditoria-insercao-e-limpeza-de-vagas.md](2026-11-25-auditoria-insercao-e-limpeza-de-vagas.md) (achado A-04 e decisão D-04, que adiou a duplicata entre fontes para uma spec própria: esta)
- **Status:** proposta

## 1. Requisitos (premissas)

| ID | Requisito |
|---|---|
| RQ-01 | A mesma vaga vinda de fontes diferentes aparece uma vez só na listagem. |
| RQ-02 | Vagas diferentes não podem ser fundidas (falso positivo é pior que duplicata: some uma vaga real). |
| RQ-03 | Adicionar uma fonte nova exige o mínimo de arquivos, e o TypeScript avisa quando falta algo. |
| RQ-04 | O guia de contribuição descreve o caminho real para criar uma fonte. |
| RQ-05 | A coleta continua cabendo no teto de 90 s por fonte. Nada de variável de ambiente, feature flag ou serviço externo novo. |
| RQ-06 | A migração não perde vagas, não quebra os índices únicos e pode ser conferida antes de aplicada. |

## 2. Como funciona hoje

**A sugestão já está implementada na estrutura.** O que falta está na qualidade da normalização e na dispersão dos metadados das fontes.

### Deduplicação

- **Chave** ([dedupe.ts:9](../../lib/server/enrich/dedupe.ts)): sha1 de empresa + título + país + cidade + modelo de trabalho, passados por `normalizeText` (minúsculas, sem acento, espaços colapsados; [text.ts](../../lib/server/enrich/text.ts)). Empresa desconhecida usa `fonte:external_id` no lugar ([enrich-job.ts:135-145](../../lib/server/jobs/enrich-job.ts)).
- **URL canônica** ([enrich-job.ts:50-62](../../lib/server/jobs/enrich-job.ts)): URL segura, sem fragmento e sem `utm_*`, `gh_src`, `ref`, `source`, `fbclid`, `gclid`.
- **Resolução no upsert** ([upsert.ts:41-80](../../lib/server/jobs/upsert.ts)): (fonte, external_id) → URL canônica → `dedupe_key` (janela de 30 dias). Índices únicos parciais em `dedupe_key` e `url_canonical` entre as ativas ([schema.ts:78-79](../../lib/server/db/schema.ts)).
- **Confiança** ([trust.ts](../../lib/server/sources/trust.ts)): na fusão, a fonte mais confiável fica com o conteúdo (ATS 3 > agregador 2 > HN/GitHub 1).
- **Atalho da coleta** ([run.ts:202-213](../../lib/server/collect/run.ts)): vaga já conhecida, com o mesmo `content_hash` e a mesma URL, não passa pelo `enrichJob` nem pelo upsert. **Consequência para esta spec:** mudar a fórmula da chave não reescreve as vagas que já estão no banco. Elas ficam com a chave antiga até o conteúdo mudar.
- **Colisão silenciosa** ([upsert.ts:133-149](../../lib/server/jobs/upsert.ts)): quando uma vaga atualizada calcula uma chave (ou URL) que já pertence a outra vaga ativa, o upsert mantém a chave antiga. Não dá erro, mas as duas linhas continuam visíveis.

**Sobre "link canônico dentro da chave":** a sugestão compõe empresa + título + link numa chave só. Isso pioraria a deduplicação entre fontes, porque a mesma vaga tem um link diferente em cada fonte (LinkedIn, Himalayas, ATS). O projeto usa link e chave como critérios **alternativos**, e esta spec mantém isso.

### Lacunas encontradas (evidência nos fixtures de `tests/fixtures/sources/`)

| ID | Lacuna | Exemplo |
|---|---|---|
| L-01 | Empresa sem remoção de sufixo societário | "resonads GmbH" × "resonads"; "Enterprise Management Solutions, Inc." |
| L-02 | Título com marcadores que variam por fonte | `(m/w/d)` aparece 28 vezes, `(m/f/d)` 2 vezes, `(f/m/d)` 1 vez; "Sr." × "Senior"; " - Remote" |
| L-03 | URL canônica não junta as variações dos ATS | `boards.greenhouse.io` × `job-boards.greenhouse.io`; Lever com `/apply`; Ashby com `/application`; `www.`; barra final |
| L-04 | Localização na chave (A-04) | ATS manda "São Paulo"/`hybrid`; agregador manda cidade nula/`unknown`: chaves diferentes |
| L-05 | Vagas fundíveis já no banco nunca se fundem (atalho + colisão silenciosa) | ver acima |

### Fontes (adapter)

- **Interface:** `Connector` ([types.ts:83](../../lib/server/sources/types.ts)) com `fetch` + `normalize`, registrada em [registry.ts](../../lib/server/sources/registry.ts). Já há teste de contrato (`tests/contract/sources.contract.test.ts`).
- **Dispersão (L-06):** uma fonte nova toca 6 listas mantidas à mão:
  1. `SourceId` em [lib/shared/types/job.ts:5](../../lib/shared/types/job.ts)
  2. `SOURCE_IDS` em [lib/shared/schemas/jobs-query.ts:5](../../lib/shared/schemas/jobs-query.ts)
  3. `SOURCE_LABELS` e `FILTERABLE_SOURCES` em [components/jobs/format.ts](../../components/jobs/format.ts)
  4. `urlParsers.source` em [lib/client/jobs/use-jobs.ts](../../lib/client/jobs/use-jobs.ts)
  5. `SOURCE_TRUST` em [trust.ts](../../lib/server/sources/trust.ts)
  6. `CONNECTORS` em [registry.ts](../../lib/server/sources/registry.ts)
- **Docs desatualizadas (L-07):** [CONTRIBUTING.md:35](../../CONTRIBUTING.md) cita "Tarefa 10 do plano"; comentários antigos em `registry.ts` ("começa vazio") e `types.ts` ("a Tarefa 10 completa este arquivo").

## 3. Decisões

### D-01: Normalização de empresa só para a chave

- **Contexto:** L-01. O nome exibido deve continuar o que a fonte mandou.
- **Opções:**
  1. Remover só sufixos societários no fim do nome (conservador).
  2. Também remover palavras genéricas ("Technologies", "Labs", "Brasil").
  3. Tabela de aliases de empresa mantida à mão.
- **Decisão:** opção 1. Nova função `normalizeCompany` em `lib/server/enrich/dedupe.ts`: `normalizeText`, troca pontuação por espaço e remove, **só no fim** e repetidamente, sufixos de uma lista fechada: `inc`, `llc`, `ltd`, `limited`, `ltda`, `sa`, `s a`, `s/a`, `me`, `eireli`, `gmbh`, `ag`, `corp`, `corporation`, `co`, `plc`, `bv`, `srl`, `sas`, `oy`, `ab`, `pty`. Nunca deixa o nome vazio (se sobrar vazio, usa o nome normalizado sem a remoção).
- **Consequências:** a opção 2 fundiria "Acme Labs" e "Acme" (empresas diferentes), o que fere RQ-02. A opção 3 não escala num projeto aberto.

### D-02: Normalização de título só para a chave

- **Contexto:** L-02.
- **Opções:**
  1. Remover marcadores de gênero e decorações de modo/local, e igualar abreviações de senioridade.
  2. Também igualar sinônimos de cargo ("Developer" × "Engineer", "Dev" × "Desenvolvedor").
- **Decisão:** opção 1. Nova função `normalizeTitle`:
  - remove marcadores de gênero entre parênteses ou colchetes: `m/w/d`, `m/f/d`, `f/m/d`, `w/m/d`, `m/f/x`, `h/f`, `f/h`, `m/f`, `all genders`, `a/e/o`, `(a)`;
  - remove segmentos finais (entre parênteses ou depois de ` - `, ` | `, ` – `) que contêm **só** palavras de modo ou região: remote, remoto, hybrid, híbrido, onsite, on-site, presencial, home office, brazil, brasil, latam, worldwide, anywhere;
  - troca `sr`/`sr.` por `senior`, `jr`/`jr.` por `junior`, `pl` por `pleno`;
  - troca pontuação por espaço e colapsa espaços.
- **Consequências:** a opção 2 funde cargos de fato diferentes ("Data Engineer" × "Data Developer" em algumas empresas) e fere RQ-02. Fica fora.

### D-03: URL canônica ciente dos ATS

- **Contexto:** L-03. A `url_canonical` **também é exibida**: o link de origem em "Minhas vagas" ([JobMiniCard.tsx:24](../../components/my-jobs/JobMiniCard.tsx)) e no gerador ([GeneratorScreen.tsx:592](../../components/generator/GeneratorScreen.tsx)). Toda transformação precisa manter uma URL que abre a mesma vaga.
- **Decisão:** em `canonicalUrl` ([enrich-job.ts:53](../../lib/server/jobs/enrich-job.ts)), depois do que já existe:
  - host em minúsculas e sem `www.` (o caminho mantém a caixa: os ids do SmartRecruiters diferenciam maiúsculas e minúsculas);
  - `job-boards.greenhouse.io` → `boards.greenhouse.io` (o mesmo vale para `job-boards.eu.greenhouse.io` → `boards.eu.greenhouse.io`, sem juntar EU com US);
  - Lever: remove o sufixo `/apply`; Ashby: remove o sufixo `/application`;
  - remove a barra final do caminho (menos na raiz);
  - ordena os parâmetros restantes da query.
- **Consequências:** tudo é reversível e mantém a página da vaga. Ficam fora (pergunta P-02): páginas de carreira próprias com `?gh_jid=` e o slug depois do id no SmartRecruiters.

### D-04: Localização na chave (A-04) só depois de medir

- **Contexto:** L-04. Tirar cidade e modo da chave resolve o caso ATS × agregador, mas funde vagas reais da mesma empresa e cargo em cidades diferentes, que a RN-05 trata como distintas.
- **Opções:**
  1. Manter a chave como está.
  2. Tirar cidade e modo da chave sempre.
  3. **Busca tolerante:** nova coluna `match_key` (empresa + título normalizados, índice não único entre as ativas). Quando a chave estrita não acha nada, o upsert busca por `match_key` e só funde se houver **exatamente uma** vaga compatível (país igual ou um dos lados nulo; cidade igual ou um dos lados nula; modo igual ou um dos lados `unknown`). Com duas ou mais, não funde (vaga de várias cidades).
- **Decisão:** opção 3, **condicionada à medição** da Fase 0/2: só entra se, depois de D-01 a D-03, ainda sobrarem duplicatas que diferem só em cidade ou modo. Exige migração Drizzle (coluna + índice) e preenchimento pelo script da D-05.
- **Consequências:** é a única opção que melhora RQ-01 sem ferir RQ-02. Custo: uma consulta a mais no upsert, só no caminho de vaga nova.

### D-05: Reaplicar a chave nas vagas existentes com um script, e fundir colisões

- **Contexto:** L-05. Por causa do atalho da coleta, a nova fórmula só valeria para vagas novas ou alteradas.
- **Opções:**
  1. Incluir uma versão da chave no `content_hash` (como já é feito com o sanitizador). Força todas as vagas a passarem pelo `enrichJob` uma vez.
  2. **Script único** que recalcula `dedupe_key` e `url_canonical` a partir das colunas já gravadas (`company`, `title`, `country`, `city`, `work_mode`, `url_canonical`) e funde os grupos que colidirem.
- **Decisão:** opção 2. A opção 1 re-sanitiza o HTML de todas as vagas numa única coleta por fonte, o que ameaça o teto de 90 s (RQ-05) e não resolve as colisões: o upsert manteria a chave antiga.
  - Nova função `mergeJobs(db, survivorId, loserIds, now)` em `lib/server/jobs/merge.ts`. Ela move os `job_sources` para a sobrevivente, faz a união de `sources`, aplica `LEAST(published_at)` e marca `expired_at = now` nas perdedoras. A sobrevivente é a de maior confiança entre as fontes e, em empate, a de `first_seen_at` mais antiga.
  - O script `scripts/rekey-jobs.ts` (`pnpm tsx`, com o shim de `server-only` usado em `scripts/discover-boards`) roda em **simulação por padrão**: imprime quantos grupos seriam fundidos, com amostras de empresa e título. Só grava com `--apply`, numa transação. Vagas com empresa desconhecida ficam de fora (a chave delas vem do `external_id`).
  - Antes de gravar, o script pega o lock de **todas** as fontes com `acquireLock` ([lock.ts:12](../../lib/server/collect/lock.ts), TTL de 5 min). Se alguma estiver ocupada por uma coleta, libera as que pegou e aborta. No fim, libera todas com `releaseLock`.
  - O upsert passa a chamar `mergeJobs` quando a atualização de uma vaga colide com a chave ou a URL de outra vaga ativa, no lugar de manter a chave antiga. Isso fecha a colisão silenciosa daqui para frente.
- **Consequências:** a simulação já serve de medição (Fase 0). As perdedoras expiram e somem da listagem em 30 dias pela retenção normal. Links salvos para elas passam a dar 404, o mesmo efeito já aceito no A-06; a quantidade é pequena e aparece na simulação.

### D-06: Catálogo único de fontes em `lib/shared`

- **Contexto:** L-06. O registro de conectores é server-only, por isso o front mantém listas próprias.
- **Opções:**
  1. Manter as listas e só melhorar o guia.
  2. **Catálogo compartilhado:** `lib/shared/sources.ts` com `SOURCES = [{ id, label, trust }, ...] as const`, na ordem do filtro da UI. `SourceId`, `SOURCE_IDS`, `SOURCE_LABELS`, `FILTERABLE_SOURCES`, `SOURCE_TRUST` e o parser da URL saem dele.
  3. Gerar as listas por script a partir do registro.
- **Decisão:** opção 2. `CONNECTORS` passa de `Partial<Record<SourceId, Connector>>` para `satisfies Record<SourceId, Connector>`. Assim, um id no catálogo sem conector (ou o contrário) vira erro de tipo. Adicionar uma fonte passa a tocar 2 arquivos de código (catálogo e conector + registro) além de fixtures, testes e `docs/fontes.md`.
- **Consequências:** a opção 3 adiciona etapa de build sem ganho. O teste que confere `FILTERABLE_SOURCES` contra o registro ([format.ts:22](../../components/jobs/format.ts)) fica redundante e vira um teste do catálogo. A confiança não é segredo, então pode morar em `lib/shared`.

### D-07: Guia de contribuição

- Reescrever a seção "Adicionar uma fonte de vagas" do [CONTRIBUTING.md](../../CONTRIBUTING.md) com o caminho real: entrada no catálogo, conector seguindo um exemplo simples (`jobicy.ts` ou `remoteok.ts`), registro, fixtures em `tests/fixtures/sources/<id>/`, teste unitário, `docs/fontes.md` e como escolher a confiança (1, 2 ou 3).
- Explicar em uma frase que a deduplicação é automática: o conector só precisa entregar empresa, título e URL corretos.
- Remover as menções a "Tarefa N do plano" em `CONTRIBUTING.md`, `registry.ts` e `types.ts`.

### Eixos sem impacto

APIs e contratos públicos (o formato de `/api/jobs` não muda; `source` aceita os mesmos ids), segurança (nenhuma superfície nova; o script roda localmente com a `DATABASE_URL` de quem opera), front/UX (só a origem das listas muda), integrações externas (nenhuma).

## 4. Testes

| Camada | O que cobre |
|---|---|
| Unitário (`tests/unit/server/enrich/dedupe.test.ts`) | `normalizeCompany` e `normalizeTitle` com casos tirados dos fixtures (GmbH, Inc., `(m/w/d)`, "Sr.", " - Remote") e **casos negativos**: "Acme Labs" ≠ "Acme", "Data Engineer" ≠ "Data Developer", nome que viraria vazio. Os testes da RN-05 continuam passando. |
| Unitário (novo `enrich-job` ou `url`) | `canonicalUrl`: variações de Greenhouse, Lever `/apply`, Ashby `/application`, `www.`, barra final, ordem dos parâmetros, caixa do caminho preservada. |
| Integração (`tests/integration/jobs/`) | `mergeJobs` (fontes movidas, `sources` unidas, perdedora expirada, sobrevivente pela confiança). Upsert com colisão de chave e de URL passa a fundir. Vaga ATS + agregador com sufixo e marcador diferentes vira uma linha só. |
| Integração (script) | Simulação não grava nada; `--apply` funde e deixa a consulta 5.4 de `scripts/db-audit.sql` toda em zero. |
| Unitário (catálogo) | Ids únicos; rótulo não vazio; confiança em {1, 2, 3}; `CONNECTORS` cobre o catálogo (já garantido pelo tipo). |
| Verificação | `pnpm typecheck && pnpm lint && pnpm test`, `pnpm test:integration` com `pnpm db:test:up`. |

## 5. Plano de entrega

### Fase 0: Medir. Esforço P

- Rodar a consulta 5.3 de `scripts/db-audit.sql` em produção e anotar o número de grupos.
- **Pronto quando:** o número está anotado nesta spec, como linha de base.

### Fase 1: Catálogo de fontes e guia (D-06, D-07). Esforço M

- Independente das outras fases e sem risco para o banco: pode ir primeiro e responde direto à parte "adapter" da sugestão.
- Arquivos: `lib/shared/sources.ts` (novo), `lib/shared/types/job.ts`, `lib/shared/schemas/jobs-query.ts`, `components/jobs/format.ts`, `lib/client/jobs/use-jobs.ts`, `lib/server/sources/trust.ts`, `lib/server/sources/registry.ts`, `lib/server/sources/types.ts`, `CONTRIBUTING.md`, testes do registro e do formato.
- **Pronto quando:** RQ-03 e RQ-04 (uma fonte de teste fictícia exige só catálogo + conector + registro, e o TypeScript reclama se faltar um).

### Fase 2: Normalização, URL canônica e fusão (D-01, D-02, D-03, D-05). Esforço M

1. `normalizeCompany` e `normalizeTitle` + testes (TDD).
2. `canonicalUrl` ciente dos ATS + testes.
3. `mergeJobs` + testes de integração.
4. Upsert funde quando colide.
5. `scripts/rekey-jobs.ts` com simulação e `--apply`.
6. Deploy → rodar a simulação em produção → conferir as amostras → `--apply` → consultas 5.3 e 5.4.
- **Pronto quando:** RQ-01, RQ-02, RQ-05, RQ-06; a 5.3 cai em relação à linha de base e a 5.4 fica toda em zero.

### Fase 3 (condicional): Busca tolerante por localização (D-04). Esforço M

- Só se a 5.3 depois da Fase 2 ainda mostrar grupos que diferem apenas em cidade ou modo.
- Migração Drizzle (`match_key` + índice parcial), preenchimento pelo script, busca no upsert, testes de "exatamente uma compatível".

**Caminho crítico:** Fase 0 → Fase 2 → (Fase 3). A Fase 1 corre em paralelo.

## 6. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Falso positivo: duas vagas distintas fundidas | Baixa | Alto (some uma vaga) | Listas fechadas e conservadoras; casos negativos nos testes; simulação com amostras antes do `--apply`. |
| Script em paralelo com a coleta | Baixa | Médio (colisão no índice, transação abortada) | O script pega o lock de todas as fontes antes de gravar e aborta se alguma estiver coletando; transação única; pode rodar de novo, porque é idempotente. |
| Link salvo de vaga perdedora vira 404 | Baixa | Baixo | Quantidade aparece na simulação; mesmo efeito já aceito no A-06. |
| Mudança na `url_canonical` quebra o link exibido | Baixa | Médio | Só transformações que mantêm a página; caixa do caminho preservada; testes com URLs reais dos fixtures. |
| Upsert mais lento com a fusão | Baixa | Baixo | A fusão só acontece em colisão, que é rara; o atalho por hash não muda. |

## 7. Perguntas em aberto

- **P-01:** A expiração das perdedoras é suficiente, ou vale redirecionar `/vagas/<id-perdedora>` para a sobrevivente (resolveria também o A-06)? Proposta: fora desta entrega.
- **P-02:** Vale tratar páginas de carreira próprias com `?gh_jid=` e o slug do SmartRecruiters na URL canônica? Depende do que a medição mostrar.
