# Spec técnica — Ampliação das fontes de vagas

- **Data:** 2026-11-24
- **Origem:** pedido do usuário na conversa ("preciso de mais fontes… buscar o máximo… veja se acha uma forma, mesmo instável, do LinkedIn"). Sem PRD próprio.
- **PRD base:** [docs/prd/2026-11-23-job-find-agregador-vagas-tech.md](../prd/2026-11-23-job-find-agregador-vagas-tech.md) (metas da seção 3; RN-09; fora de escopo na linha 79)
- **Spec base:** [docs/tech/2026-11-23-job-find-agregador-vagas-tech.md](2026-11-23-job-find-agregador-vagas-tech.md) (D-07, coletor e conectores)
- **Registro de fontes:** [docs/fontes.md](../fontes.md)
- **Especialistas consultados:** pesquisa de fontes e ATS (general-purpose, com requisições reais em 2026-11-24) e pesquisa técnica/jurídica sobre o LinkedIn (general-purpose). As decisões e a consolidação são do Tech Lead.

## 1. Situação atual (medida no banco local em 2026-11-24)

| Fonte | Ativas | Duração média da coleta |
|---|---:|---:|
| Greenhouse (19 boards) | 250 | 16,8 s |
| Ashby (11) | 130 | 5,1 s |
| Himalayas | 125 | 2,0 s |
| Hacker News | 109 | 4,5 s |
| Lever (5) | 82 | 7,5 s |
| We Work Remotely | 52 | 4,7 s |
| Jobicy | 48 | 2,6 s |
| GitHub (5 repos) | 40 | 2,4 s |
| RemoteOK | 27 | 3,9 s |
| **Total** | **847** (192 nacionais, 465 internacionais, 190 sem origem) | |

As metas do PRD são **≥ 3.000 ativas** e **≥ 800 nacionais**. Hoje o volume está em 28% da primeira meta e 24% da segunda.

## 2. Requisitos (premissas registradas a partir do pedido)

| ID | Requisito | Origem |
|----|-----------|--------|
| RF-A1 | Chegar a ≥ 3.000 vagas ativas só com fontes cujos termos permitem coleta (RN-09). | Pedido + meta do PRD |
| RF-A2 | Ampliar as vagas nacionais rumo a ≥ 800. "Nacional" continua sendo vaga com local no Brasil; vaga remota internacional que aceita o Brasil **não** conta (decisão do usuário em 2026-11-24). | Pedido + PRD |
| RF-A3 | LinkedIn: **só link de busca** montado a partir dos filtros. Nenhuma coleta (decisão do usuário em 2026-11-24). | Pedido |
| RF-A4 | **Cancelado em 2026-11-24:** a Adzuna é paga para uso comercial (chave gratuita só para avaliação), e a regra do projeto aceita apenas serviços externos gratuitos. Texto original: Adzuna entra já, com duas variáveis de ambiente novas: `ADZUNA_APP_ID` e `ADZUNA_APP_KEY` (autorizadas pelo usuário em 2026-11-24). | Pedido |
| RNF-A1 | A coleta inteira continua cabendo no budget de 240 s por execução (`lib/server/collect/run.ts:14`) com o cron de hora em hora. | Spec base D-07 |
| RNF-A2 | Fetch seguro mantido: só hosts fixos, sem subdomínio dinâmico de cliente. | Spec base D-07 / segurança |
| Fora | Coleta do LinkedIn, Gupy, Coodesh, Remotive e Remotar (termos proíbem). Workable via busca global (API interna e não documentada). | RN-09 |

## 3. Por que não coletar o LinkedIn (registro da avaliação)

Testes feitos em 2026-11-24, de IP residencial, sem login, com 6 requisições espaçadas:

- **O endpoint funciona.** `GET /jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=…&geoId=106057199&f_TPR=r86400&start=N` devolve **200** com HTML de 10 cards por página. `GET /jobs-guest/jobs/api/jobPosting/<id>` devolve o detalhe completo.
- **É instável.** Deu **429 já na 4ª requisição**. A comunidade relata bloqueio após 50 a 100 requisições por IP, e IP de datacenter (Vercel) é bloqueado bem antes. Todos os projetos ativos (JobSpy, linkedin-jobs-api) dependem de proxy residencial pago.
- **Coletar pelo navegador do usuário é inviável.** A resposta não traz `Access-Control-Allow-Origin`.
- **Jurídico:**
  - O User Agreement (§1.2) vale também para **Visitors**. O §8.2 proíbe scraping, bots, plugins e copiar ou distribuir o conteúdo.
  - O `robots.txt` bloqueia `/jobs-guest/` até para o Googlebot.
  - O hiQ terminou em consent judgment de US$ 500 mil a favor do LinkedIn. A Proxycurl fechou em 2025 depois de ser processada.
  - O argumento de Meta v. Bright Data (coleta deslogada) é fraco aqui, porque o contrato do LinkedIn cita Visitors expressamente.
- **Decisão (usuário):** só o link de busca (D-06). O PRD continua igual. Só a seção 8 ganha a menção ao link.

## 4. Decisões

### D-01: Rodízio de boards com prazo por execução nos conectores multi-board

**Contexto:** cada board custa cerca de 0,9 s (Greenhouse: 19 boards em 16,8 s, com 3 simultâneos). Passar de 35 para mais de 250 boards (D-03) leva uma coleta completa a mais de 100 s só no Greenhouse, o que estoura o RNF-A1 junto com as outras fontes. Hoje a expiração por coletas perdidas (`markMissedRuns`, `lib/server/jobs/expire.ts:24`) vale para a fonte inteira.

**Opções:**
1. Subir a concorrência para 10 ou mais por host. É simples, mas aumenta o risco de rate limit sem número publicado (Greenhouse e Ashby) e não escala para 500 boards.
2. **Rodízio:** cada execução processa os boards a partir de um cursor até um prazo e guarda no cursor onde parou. A expiração passa a valer só para os boards lidos nessa execução.
3. Criar mais um cron, com um agendamento para cada grupo de boards. Isso multiplica a configuração da Vercel e o lock.

**Decisão:** opção 2.
- **Prazo e rodízio:**
  - `ConnectorContext` ganha `deadlineAt: number`, calculado pelo runner a partir do budget e de um teto por fonte de **90 s**.
  - `fetchBoardsPooled` (`lib/server/sources/boards.ts`) começa no índice do cursor, para de pegar boards novos quando falta menos de 5 s para o prazo e grava `setCursor(próximoÍndice)`.
  - A concorrência passa de 3 para 5 por conector.
- **Expiração por board:**
  - O conector informa os boards concluídos com um novo `ctx.reportScope(prefixes: string[])`.
  - `markMissedRuns` ganha o parâmetro opcional `scopePrefixes` e filtra `external_id LIKE 'board:%'`, o que funciona porque o `externalId` já é `${board}:${id}` (`greenhouse.ts:79`, `ashby.ts:112`, `lever.ts:124`).
  - **Não precisa de migração.** O índice de `job_sources` tem PK `(source, external_id)`, então o `LIKE` por prefixo usa a PK.
- **Ciclo:** com 250 boards e cerca de 90 s por execução (cerca de 100 boards), cada board é revisto a cada 3 h. A expiração continua exigindo 3 coletas perdidas daquele board.

**Consequências:**
- O atraso de uma vaga nova num board grande sobe até cerca de 3 h. É aceitável pela meta de frescor do PRD (p90 ≤ 2 h medido na média). Os boards com mais vagas BR ficam no começo da lista, mas mesmo assim entram no rodízio.
- A regra "lista vazia não expira" continua valendo por board.

### D-02: Conectores novos (sem chave)

| Fonte | Endpoint (fixo) | Modo | Notas de decisão |
|---|---|---|---|
| **4dayweek** (`fourdayweek`) | `https://4dayweek.io/api/v2/jobs?limit=100&work_arrangement=remote&category=engineering,data,security` e `…&country=Brazil` (todas as categorias tech) | Incremental (cursor de página), no máximo **12 páginas por execução** | O maior volume testado: 4.081 remotas tech e 624 no Brasil. Uma página tem cerca de 960 KB e leva 2,1 s, então o teto de páginas mantém a fonte em cerca de 30 s. A consulta Brasil roda primeiro. A atribuição pedida é link para 4dayweek.io. Por agregar vagas de ATS, a duplicação com Greenhouse e Ashby é resolvida pela `dedupe_key` existente (`lib/server/jobs/upsert.ts`). Spike S-1: confirmar a ordenação por data, para o cursor incremental fazer sentido |
| **Get on Board** (`getonboard`) | `https://www.getonbrd.com/api/v0/categories/<cat>/jobs?per_page=100&page=N` em 7 categorias tech | Snapshot completo | Cerca de 620 vagas tech na América Latina. Descartar as presenciais fora do Brasil já no `normalize` (devolve `null`), para não poluir o índice com vagas presenciais do Chile. Os termos exigem crédito "Get on Board", link `public_url`, atualização a cada 24 h ou menos, remoção em 24 h e não repassar dados (a mesma regra do Himalayas) |

### D-03: Ampliar as listas curadas com descoberta offline

**Contexto:** a maior alavanca sem conector novo é a lista de boards. Validar só pelo HTTP 200 dá falso positivo (`greenhouse/arco` é uma empresa dos EUA e `greenhouse/nuvem` é de saúde).

**Opções:**
1. Curadoria manual. É lenta e é o que limitou a lista a 35 boards.
2. Descoberta automática no próprio cron. Isso sai do princípio "configuração no código" (PRD: sem painel de fontes) e coloca empresa desconhecida em produção sem revisão.
3. **Script offline** gera uma lista candidata, uma pessoa revisa e a lista vai para o código num PR.

**Decisão:** opção 3.
- **O script:** `scripts/discover-boards.ts`, rodado manualmente com `pnpm tsx`, lê três fontes de slugs:
  - [ConorsCode/open-jobs-data](https://github.com/ConorsCode/open-jobs-data) (MIT, 378 empresas);
  - [yc-oss hiring.json](https://yc-oss.github.io/api/companies/hiring.json), com 1.472 empresas para testar no Greenhouse, Ashby e Lever;
  - índice do Common Crawl para `job-boards.greenhouse.io/*` e `jobs.ashbyhq.com/*`.
- **Validação:** cada slug é testado no endpoint da API. Ele só é aceito com vagas, nome do board coerente e pelo menos 30% de vagas tech **ou** alguma vaga no Brasil, na América Latina ou remota global.
- **Saída:** um arquivo de candidatos ordenado por vagas BR. As listas aprovadas saem dos conectores e vão para `lib/server/sources/boards/{greenhouse,ashby,lever,smartrecruiters}.ts`, ordenadas por relevância BR (efeito no D-01).
- **Meta:** Greenhouse de 19 para cerca de 150, Ashby de 11 para cerca de 80, Lever de 5 para cerca de 20. Primeiros achados: turing, wise (Greenhouse); oyster, andela (Ashby); kavak (Lever).

### D-04: Mais repositórios do GitHub

Entram 7 repositórios com issues abertas recentes: `soujava/vagas-java`, `DevOps-Brasil/Vagas`, `phpdevbr/vagas`, `CocoaHeadsBrasil/vagas`, `dotnetdevbr/vagas`, `vuejs-br/vagas` e `flutterbr/vagas`. São cerca de 40 vagas, todas BR. `datascience-br/vagas` ficou fora porque a última vaga é de agosto. A concorrência atual (3) e o `GITHUB_TOKEN` já cobrem: são 12 repositórios com 1 a 2 páginas cada.

### D-05: SmartRecruiters e Adzuna

> **Atualização 2026-11-24:** a parte da Adzuna foi cancelada. Os termos só liberam a chave gratuita para avaliação, e uso comercial exige licença. Sem variáveis `ADZUNA_*`.

- **SmartRecruiters** (`smartrecruiters`, que já está no `SourceId`):
  - Endpoint: `https://api.smartrecruiters.com/v1/companies/<id>/postings?limit=100&offset=N&country=br`.
  - É multi-board e usa D-01.
  - A lista já traz `function.id`, então só os itens com `information_technology` buscam o detalhe (`/postings/<id>`). Isso controla o custo de uma requisição por vaga.
  - Um id inexistente devolve 200 com `totalFound: 0`, então a validação conta `totalFound`.
  - Boards iniciais: Experian (182 BR), BoschGroup (108 BR) e os que o D-03 achar.
- **Adzuna** (`adzuna`):
  - Endpoint: `https://api.adzuna.com/v1/api/jobs/br/search/<page>?app_id&app_key&category=it-jobs&results_per_page=50&max_days_old=3&sort_by=date`.
  - Modo incremental, com no máximo 10 páginas por execução.
  - **Sem as duas variáveis, o conector não entra no registro.** Ele é omitido de `CONNECTORS` e a página Fontes não o lista. Assim ninguém vê uma fonte "em falha" num fork sem chave.
  - É a fonte com mais chance de fechar a meta nacional (RF-A2).
  - Spike S-2: ler os termos e a regra de atribuição (provável logo ou texto "Jobs by Adzuna"), medir o volume tech BR e checar se `redirect_url` passa por rastreamento da Adzuna. Se passar, esse link vai como `applyUrl`, sem alteração.
  - As chaves nunca vão para log, como já acontece com `GITHUB_TOKEN`.

### D-06: Link de busca do LinkedIn

- **Arquivo:** `lib/client/jobs/linkedin-search.ts` (função pura) monta `https://www.linkedin.com/jobs/search/?keywords=<texto + stacks>&geoId=106057199&f_TPR=r604800` a partir dos filtros da URL. Acrescenta `&f_WT=2` quando o filtro é remoto e `&f_E=<nível>` com a senioridade mapeada.
- **Tela:** o link "Buscar também no LinkedIn" fica na `JobsPage`, perto da busca e do estado vazio, com `target="_blank" rel="noopener noreferrer"`.
- **Sem rede e sem CSP:** nenhuma requisição ao LinkedIn sai do app e a CSP não muda, porque navegação não é afetada por `connect-src`.
- **Regras:** nenhum dado do perfil sai do navegador além do que a pessoa já vê nos filtros. Sem logo do LinkedIn, só texto.

### D-07: Fontes de cauda longa

Entram depois de checar os termos (RN-09), cada uma com esforço P:
- Working Nomads (37 vagas);
- NoDesk e Jobspresso, via RSS e reaproveitando o parser do WWR;
- Arbeitnow, só as remotas;
- Landing.jobs, só as remotas.

Somam menos de 150 vagas e aumentam a diversidade, não o volume. Getro (job boards de VCs como Kaszek e monashees) vira o **spike S-3**, porque pode ser a melhor fonte de startups BR.

Ficam para quando houver lista de empresas vinda do D-03 os ATS europeus Recruitee, Personio, Teamtailor, Breezy e Rippling. Eles usam **subdomínio por cliente**, o que conflita com o RNF-A2. Se entrarem, a allowlist passa a ser a lista curada de hosts completos gerada no código, nunca um curinga.

### Eixos sem impacto

- Modelo de dados: o D-01 não pede migração, porque o `SourceId` é `text`.
- APIs públicas do app: sem mudança.
- Autenticação: sem mudança.
- Cache: a invalidação continua a mesma.
- Banco: cerca de 4 a 5 mil vagas cabem no Neon de 0,25 CU. A spec base já previa 3.000 e mais, mas vale reconferir o p95 de `/api/jobs` no portão.

## 5. Arquivos afetados (por toda fonte nova)

- `lib/shared/types/job.ts`: união `SourceId` (`fourdayweek` e `getonboard`; `adzuna` foi cancelada em 2026-11-24 (serviço pago); `smartrecruiters` já existe).
- `lib/shared/schemas/jobs-query.ts`, `lib/client/jobs/use-jobs.ts` e `components/jobs/format.ts`: lista e rótulos de origem.
- `lib/server/sources/<fonte>.ts` e `lib/server/sources/registry.ts`.
- `tests/fixtures/sources/<fonte>/`, `tests/unit/server/sources/<fonte>.test.ts` e `tests/contract/sources.contract.test.ts`.
- `docs/fontes.md`: linha na tabela com link e data dos termos (RN-09) e boards curados. ~~`.env.example`: Adzuna~~ (cancelada em 2026-11-24: serviço pago).
- Para o D-01: `lib/server/sources/types.ts`, `boards.ts`, `lib/server/collect/run.ts`, `lib/server/jobs/expire.ts` e `tests/integration/collect/run.test.ts`.

## 6. Plano de entrega

**Fase 1: volume sem chave.** É o menor corte com maior ganho.
| Tarefa | Esforço | Depende de |
|---|---|---|
| D-01 rodízio, prazo e expiração por board, com testes de integração (board não lido não expira; cursor avança e dá a volta) | M | — |
| D-03 script de descoberta, revisão e listas novas de Greenhouse, Ashby e Lever | M | D-01 (para colocar as listas grandes em produção) |
| D-02 conector 4dayweek (spike S-1 antes) | P | — |
| D-02 conector Get on Board | P | — |
| D-04 repositórios do GitHub | P | — |
| D-06 link do LinkedIn | P | — |

Ganho estimado: cerca de 2.000 a 2.500 vagas a mais (4dayweek de 1.200 a 1.500 após deduplicação e teto de páginas; boards de 800 a 1.000; Get on Board cerca de 250; GitHub cerca de 40). Total esperado: **3.000 a 3.500 ativas**, mas só cerca de 450 nacionais.

**Fase 2: vagas nacionais.** SmartRecruiters (M) e ~~Adzuna (M, spike S-2 antes)~~ (Adzuna cancelada em 2026-11-24: serviço pago). É onde a meta de 800 nacionais pode fechar.

**Fase 3: cauda longa e descoberta.** D-07 e spike S-3 (Getro).

O caminho crítico é D-01 → D-03. As tarefas 4dayweek, Get on Board, GitHub e LinkedIn são independentes entre si e podem rodar em paralelo.

**Critério de pronto da Fase 1:**
- 24 h depois do deploy local, há 3.000 ou mais ativas.
- Nenhuma execução da coleta passa de 240 s.
- `source_runs` está sem erro.
- Cada fonte nova tem os termos registrados em `docs/fontes.md`.
- `pnpm typecheck && pnpm lint && pnpm test` passa.

## 7. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Rate limit sem número publicado (Greenhouse e Ashby) com mais boards e concorrência 5 | Média | Médio | Rodízio limita a cerca de 100 requisições por execução por fonte; 429 no board vira `reportPartial`, sem retentativa agressiva |
| 4dayweek duplica muito do Greenhouse e do Ashby | Alta | Baixo | `dedupe_key` existente; medir a taxa de duplicação no portão |
| Os termos de 4dayweek, ~~Adzuna (cancelada em 2026-11-24: serviço pago)~~ ou SmartRecruiters mudam ou proíbem republicar | Baixa | Alto | RN-09: tudo checado e datado antes de produção; o conector sai do registro se for preciso |
| A meta nacional não fecha (a Adzuna foi cancelada em 2026-11-24: serviço pago) | Média | Médio | Pedir autorização por escrito a Remotar (4.774 vagas, a maior fonte BR achada) e Programathor (ação do produto, já prevista na spec base) |
| Lista curada grande com empresa errada (falso positivo) | Média | Baixo | Validação por nome e parcela tech no script, mais revisão humana no PR |

## 8. Perguntas em aberto

- S-1: o 4dayweek ordena por data de publicação? Se não, o modo vira snapshot por consulta Brasil e a consulta remota fica com teto fixo.
- ~~S-2: termos e atribuição da Adzuna, e o volume tech BR real.~~ Cancelado em 2026-11-24 (Adzuna é paga).
- S-3: o Getro tem API ou feed público por rede?
- Ação do produto: mandar e-mail pedindo autorização para Remotar e Programathor (já prevista na spec base, pergunta 1).

## Histórico

- 2026-11-24: versão inicial.
