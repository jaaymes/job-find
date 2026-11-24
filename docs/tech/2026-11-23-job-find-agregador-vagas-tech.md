# Job Find — Decisões Técnicas

- **PRD de origem:** [docs/prd/2026-11-23-job-find-agregador-vagas-tech.md](../prd/2026-11-23-job-find-agregador-vagas-tech.md)
- **Status:** Rascunho
- **Data:** 2026-11-23
- **Repositórios/módulos afetados:** repositório novo e público [`jaaymes/job-find`](https://github.com/jaaymes/job-find) (greenfield, open-source)
- **Protótipo das telas (Claude Design):** https://claude.ai/artifact/RRMGiqTJomVt29Yq9EZL6Y
- **Especialistas consultados:** arquitetura Next.js/Vercel/Postgres, fontes de vagas, IA/parsing/PDF no cliente, provedores de IA (BYOK), segurança/LGPD (skill `seguranca`)

## 1. Resumo

O Job Find é um monólito Next.js 16 (App Router) na Vercel Hobby. Ele tem um Postgres Neon que guarda **somente** o índice público de vagas. Uma coleta agendada pelo Vercel Schedules roda de hora em hora e lê ~10 fontes abertas (Himalayas, boards Greenhouse/Lever/Ashby curados, Jobicy, RemoteOK, We Work Remotely, GitHub issues e HN). As vagas são normalizadas, enriquecidas e deduplicadas no Postgres.

As páginas são shells estáticos na CDN. A lista é carregada pelo `GET /api/jobs`, que também fica em cache na CDN e é invalidado por tag ao fim de cada coleta. Tudo o que é pessoal roda no navegador: perfil, score, chamadas à IA escolhida pelo usuário com a própria chave (BYOK: OpenRouter via OAuth PKCE como caminho recomendado, mais OpenAI, Anthropic, Gemini, DeepSeek, IA local e outros), extração de PDF/DOCX e geração do PDF. O código é open-source (MIT).

**Maiores riscos:**
- Estourar as cotas gratuitas: 100 CU-h/mês do Neon e 4 h/mês de CPU ativa da Vercel.
- XSS, que exporia a chave e o currículo guardados no localStorage.
- Volume de vagas nacionais limitado pelos termos de uso das fontes brasileiras.

## 2. Entendimento do projeto

- O projeto é greenfield: o diretório só contém o PRD. Não há código, convenções nem testes a seguir.
- O ambiente local tem Node 24 e pnpm.
- Versões estáveis conferidas no npm em 23/11/2026:
  - next 16.4.6 e react 19.3.1
  - drizzle-orm 0.45 e drizzle-kit 0.31, com @neondatabase/serverless 1.2
  - tailwindcss 4.3, @tanstack/react-query 5.108, nuqs 2.10 e zod 4.6
  - ai 7.0 e @openrouter/ai-sdk-provider 3.1
  - unpdf 2.2, mammoth 1.13, @react-pdf/renderer 4.9 e franc-min 6.2
  - vitest 5.1 e @playwright/test 1.65
- **Divergências encontradas no PRD** (já corrigidas nele, ver Histórico):
  - O PRD dizia que o Hobby só tem cron 1x/dia. Isso vale só para o *Cron Jobs* legado. O **Vercel Schedules** (beta) roda até a cada 15 minutos no Hobby. As funções também podem durar até 300 s com Fluid Compute.
  - O Neon Free tem 1 GB, não 0,5 GB. O gargalo real é o limite de **100 CU-hours por mês**.
  - A Gupy e a Coodesh **proíbem agregação** nos termos de uso, por isso saíram da lista de fontes. A meta de vagas nacionais passou a ser **≥ 800** (decisão de 2026-11-23).

## 3. Requisitos considerados

| ID | Requisito (resumo) | Tipo | Coberto por |
|----|--------------------|------|-------------|
| RF-01 | Coleta de hora em hora | Funcional | D-02, D-07, Fase 1 |
| RF-02/03 | Normalização e deduplicação | Funcional | D-04, D-07 |
| RF-04/05/06 | Enriquecimento de stacks, origem e modelo | Funcional | D-08 |
| RF-07 | Expiração | Funcional | D-04 |
| RF-08/09/10 | Listagem por cursor, filtros e abas | Funcional | D-05, D-06, Fase 1 |
| RF-11 | Configurações de IA multi-provedor (BYOK) | Funcional | D-10, D-17, Fase 2 |
| RF-24 | Repositório open-source | Funcional | D-18, Fase 1 |
| RF-12/13/14 | Importação, estruturação e edição do perfil | Funcional | D-12, D-11, Fase 2 |
| RF-15 | Score local | Funcional | D-13, Fase 2 |
| RF-16/17 | Análise por IA e geração de CV e carta | Funcional | D-11, Fase 3 |
| RF-18 | PDF no navegador | Funcional | D-14, Fase 3 |
| RF-19/20 | Favoritos, status e exportação/importação | Funcional | D-09, Fase 4 |
| RF-21 | Página Fontes | Funcional | D-07, Fase 4 |
| RF-22/23 | Filtros salvos, selo "Nova" e salário | Should | Fase 4 |
| RNF-01 | Desempenho da listagem | Não funcional | D-05, D-06 |
| RNF-02 | Tempos da IA | Não funcional | D-11 (raciocínio baixo, streaming) |
| RNF-03/04 | Limites e resiliência da coleta | Não funcional | D-07 |
| RNF-05/06/07 | Privacidade, chave e endpoint | Não funcional | D-15, SEC-01…12 |
| RNF-08/09 | Acessibilidade e responsividade | Não funcional | D-16 |
| RNF-10 | Limite do localStorage | Não funcional | D-09 |
| RNF-11 | Custo (free tier) | Não funcional | D-01, D-06, seção 8 |

**Fora de escopo técnico:**
- OCR de PDF escaneado.
- Emitir `JobPosting` em schema.org (Himalayas e Remotive proíbem repassar as vagas ao Google Jobs).
- SEO de vagas individuais.
- Branch do Neon por PR.

## 4. Decisões

### D-01: Monólito Next.js 16 com páginas estáticas e dados pela API em cache

- **Contexto:** o plano Hobby limita a CPU ativa a 4 h/mês, e o Neon Free limita a computação a 100 CU-h/mês. Cada página renderizada no servidor gasta as duas cotas. A CSP estrita (D-15) também afeta o modo de renderização.
- **Opções:**
  - A) A primeira página da lista é renderizada no servidor (RSC), com mais requisições pela API depois.
  - B) Todas as páginas são shells estáticos e a lista vem do `/api/jobs` com cache na CDN.
  - C) Usar `cacheComponents`/`"use cache"`.
- **Decisão:** **B**.
- **Por quê:** é o modelo mais barato. Quando a resposta está em cache na CDN, não executa nenhuma função nem acorda o banco. Também é compatível com a CSP por hash/SRI. O Himalayas proíbe repassar vagas ao Google, então perdemos pouco em SEO.
- **Consequências:**
  - O LCP depende de uma requisição à API depois do carregamento. Mitigação: skeleton, preconnect e a resposta quase sempre vindo da CDN.
  - O detalhe da vaga (`/vagas/[id]`) também é um shell que busca `/api/jobs/[id]`.
- **Estrutura de pastas:**
  - `app/(site)/{page,vagas/[id],fontes,privacidade}`
  - `app/(local)/{perfil,configuracoes,configuracoes/callback,gerador/[jobId],minhas-vagas}`: client components carregados com `ssr:false`
  - `app/api/{jobs,jobs/[id],cron/collect}/route.ts`
  - `lib/server/*` (`server-only`): `db`, `jobs`, `sources`, `collect`
  - `lib/client/*` (`client-only`): `ai`, `score`, `storage`, `pdf`, `extract`
  - `lib/shared/*` (isomórfico): `stacks`, `schemas`, `url`
- *Especialista: arquitetura.*

### D-02: Vercel Schedules de hora em hora, com uma invocação que processa todas as fontes

- **Contexto:** a coleta precisa rodar de hora em hora sem estourar o tempo máximo da função (300 s).
- **Opções:**
  - A) Vercel Schedules chama a rota uma vez por hora e a rota processa todas as fontes em paralelo.
  - B) GitHub Actions com uma chamada por fonte (matriz).
  - C) A rota chama a si mesma para dividir o trabalho (fan-out).
- **Decisão:** **A**, no minuto `17` de cada hora (o horário cheio é mais disputado, e o Jobicy pede para evitar o minuto 00). O GitHub Actions fica documentado como plano B, caso o Schedules (que está em beta) falhe.
- **Por quê:** a coleta é quase toda espera de rede. Com `Promise.allSettled`, concorrência de 5, timeout de 20 s por fonte e um orçamento total de 240 s, cabe com folga. Não depende de serviço externo, e o `?sources=` continua disponível para reprocessar uma fonte manualmente.
- **Consequências:**
  - A rota é protegida por `CRON_SECRET` (aprovado), enviado em `Authorization: Bearer`.
  - **Premissa a validar no spike:** o Schedules envia esse header como o Cron Jobs envia. Se não enviar, a alternativa é configurar o header no Schedules ou usar o plano B.
- *Especialistas: arquitetura e segurança.*

### D-03: Drizzle com driver Neon e migrações SQL aplicadas no build de produção

- **Opções:**
  - A) Drizzle.
  - B) Prisma 7: `tsvector` vira `Unsupported`, e o cursor composto e a busca textual exigiriam `$queryRaw`.
- **Decisão:** **Drizzle**.
  - Leituras usam `neon-http` com `db.batch()`, que traz os itens e os contadores numa única ida ao banco.
  - O coletor usa `neon-serverless` (Pool sobre WebSocket), porque precisa de transações.
  - As migrações vêm do `drizzle-kit generate` e ficam versionadas em `drizzle/`, podendo ser editadas à mão (extensões, funções, índices parciais).
  - O build roda `if [ "$VERCEL_ENV" = production ]; then pnpm db:migrate; fi && next build`. O `VERCEL_ENV` é uma variável do próprio sistema da Vercel, então nenhuma variável nova é criada.
- **Consequências:**
  - Só aceitamos migrações expand/contract compatíveis com a versão anterior do código, porque o Instant Rollback não reverte o banco.
  - A região é **gru1** (função) com Neon em **aws-sa-east-1**, se o Marketplace oferecer. Caso contrário, iad1 com us-east-1.
- *Especialista: arquitetura.*

### D-04: Modelo de dados com chave numérica, contadores por fonte e deduplicação por índice único parcial

- **Decisão:** o DDL completo está na seção 5. Os pontos principais:
  - `id bigint identity`. Como o identificador cresce na ordem de inserção, o desempate `id DESC` já atende a RN-02 ("empate → coletado_em DESC") sem precisar de uma terceira coluna no cursor.
  - `job_sources` é uma tabela estreita que guarda `last_seen_at` e `missed_runs` por fonte. A linha em `jobs` só é atualizada quando o `content_hash` muda, o que evita reescrever 20 mil linhas a cada hora.
  - **Deduplicação (RN-05):** índice único parcial em `dedupe_key` e outro em `url_canonical`, ambos `WHERE expired_at IS NULL`. A chave é o sha1 de empresa, título, país, cidade e modelo de trabalho, todos normalizados. A janela de 30 dias é aplicada no upsert: se o registro encontrado tem `first_seen_at` com mais de 30 dias, ele é expirado e a vaga é inserida como nova.
  - `published_at = LEAST(atual, nova, now())`. Assim, uma fonte que "republica" a vaga não a faz subir na lista, e datas no futuro são descartadas.
  - **Expiração (RF-07):** acontece com mais de 45 dias, ou quando a vaga passa 3 coletas seguidas sem aparecer em *nenhuma* fonte. O contador `missed_runs` só incrementa quando:
    - a fonte terminou a coleta com sucesso;
    - a fonte é `fullSnapshot` (entrega a lista completa a cada coleta);
    - a fonte trouxe pelo menos 50% do volume da coleta anterior.
  - **Fontes incrementais** (Himalayas por cursor, Jobicy com 7 dias, HN): só a regra dos 45 dias vale. No GitHub, uma issue fechada expira a vaga.
  - **Retenção:** um `DELETE` diário apaga as vagas expiradas há mais de 30 dias, na execução das 03:17.
- **Tamanho estimado:** cerca de 200 a 250 MB para 20 mil vagas ativas, ou seja, ~25% do 1 GB do Neon Free.
- *Especialista: arquitetura.*

### D-05: Busca textual em Postgres com `unaccent` e dicionário por idioma

- **Decisão:**
  - O vetor de busca (`search_vector`) é calculado no upsert por uma função IMMUTABLE.
  - Título, empresa e stacks usam o dicionário `simple`, com peso A. Título e descrição usam stemming pelo idioma da vaga, com peso C.
  - A consulta faz um OU entre `websearch_to_tsquery` nos dicionários `simple`, `portuguese` e `english`.
  - O SQL é montado só com os filtros presentes, sem o padrão `$x IS NULL OR …`, que estraga o plano de execução.
  - `statement_timeout` de 3 s.
- **Descartado:** um serviço de busca externo (Algolia ou Meilisearch), que adicionaria custo e infraestrutura. O Postgres atende 20 mil linhas com folga.
- *Especialista: arquitetura.*

### D-06: Cache na CDN invalidado por tag ao fim da coleta e rate limit no WAF

- **Decisão:**
  - **Headers de cache do `/api/jobs`:**
    - `Vercel-CDN-Cache-Control: max-age=900, stale-while-revalidate=86400, stale-if-error=86400`
    - `Vercel-Cache-Tag: jobs`
    - `Cache-Control: public, max-age=30`
  - **Invalidação:** quando a coleta teve mudanças, ela chama `invalidateByTag('jobs')` de `@vercel/functions`. Isso invalida o cache sem apagar: a CDN continua servindo a versão antiga enquanto busca a nova (stale-while-revalidate).
  - **URL canônica:** o cliente gera a URL com os parâmetros ordenados e sem os valores padrão, para maximizar acertos no cache.
  - **Contadores das abas:** são calculados só na primeira página.
  - **Rate limit:** uma regra única do WAF da Vercel (disponível no Hobby): `/api/*` aceita 120 requisições por 60 s por IP e responde 429 acima disso. O limite é 120, e não os 60 do PRD, porque o filtro de chance pode buscar várias páginas de uma vez (D-13).
- **Por quê:** o cache é o principal escudo das cotas do Neon. O `stale-if-error` mantém o site no ar mesmo se o Neon suspender por cota.
- **Descartado:**
  - Rate limit numa tabela do Postgres, que acordaria o banco a cada requisição.
  - Rate limit em KV, que exigiria uma variável de ambiente nova.
- *Especialistas: arquitetura e segurança.*

### D-07: Coletor com conectores isolados, lock por fonte e `source_runs` como log oficial

- **Decisão:**
  - **Interface do conector:**
    - `id`
    - `fullSnapshot: boolean`
    - `minIntervalMinutes`
    - `attribution: { label, url, dofollow }`
    - `fetch(ctx): AsyncIterable<RawJob>`
    - `normalize(raw): NormalizedJob | null`, que retorna `null` para vagas que não são de tecnologia (RN-01)
  - **Fetch seguro:**
    - só para URLs base fixas no código;
    - `redirect: 'manual'`;
    - timeout de 20 s;
    - limite de 10 MB por resposta;
    - 1 retentativa com backoff;
    - validação do payload com Zod.
  - **Lock por fonte:** `source_state.locked_until`, atualizado com `UPDATE … WHERE locked_until < now()`, evita duas coletas simultâneas da mesma fonte.
  - **Saúde da fonte:** `consecutive_failures` igual ou maior que 3 marca a fonte como "falhando" na página Fontes.
  - **Logs:** os logs de runtime do Hobby duram só 1 h, então `source_runs` é o log oficial da coleta.
  - **Alerta de coleta parada:** a página Fontes mostra um aviso se a última coleta bem-sucedida tem mais de 3 h.
  - **Sanitização:** só acontece quando o `content_hash` do conteúdo bruto muda, para poupar a cota de CPU.
- **Fontes do MVP** (estimativa nacional / internacional; detalhes em `docs/fontes.md`, a criar na Fase 1):

| # | Fonte | Snapshot | Atribuição obrigatória | Nac. / Int. |
|---|---|---|---|---|
| 1 | Himalayas (`/jobs/api`, cursor incremental, com `HIMALAYAS_API_KEY`) | incremental | Link visível para o Himalayas; `applicationLink` intacto; não repassar a agregadores ou ao Google | ~100 / ~1.800 |
| 2 | Greenhouse (curado: stone, c6bank, btgpactual, xpinc, inter, quintoandar, gympass, clara, ebanx, vtex, jusbrasil, wildlifestudios, getnet, gitlab, canonical, twilio, datadog, stripe, databricks) | full | Link para a vaga | ~450 / ~600 |
| 3 | Ashby (curado: nubank, supabase, openai, posthog, linear, sanity, replit, vanta, plaid, ramp, notion, cohere) | full | Link para a vaga | ~60 / ~400 |
| 4 | Lever (curado: ciandt, neon, swile, toptal, spotify) | full | Link para a vaga | ~110 / ~50 |
| 5 | Jobicy (`geo=brazil\|latam`, engineering, no máximo 1 vez por hora) | incremental (7 dias) | Crédito com link; candidatura pelo link do Jobicy | ~100 / ~200 |
| 6 | GitHub issues (frontendbr, backend-br, react-brasil, qa-brasil, androiddevbr…, com `GITHUB_TOKEN`) | full (só issues abertas) | Link para a issue | ~60 / 0 |
| 7 | We Work Remotely RSS (categorias tech) | full | "via We Work Remotely" com link; confirmar a permissão por e-mail | 0 / ~100 |
| 8 | RemoteOK (`/api`, ignorando o item [0]) | full | Link **dofollow** e citação "Remote OK"; sem o logo deles | 0 / ~100 |
| 9 | HN "Who is hiring" (Algolia) | incremental | Link para o comentário | ~5 / ~200 |
| 10 | SmartRecruiters (curado: Experian…) | full | A confirmar | ~80 / ~50 (só entra se a autenticação e os termos forem confirmados) |

  - **Total:** cerca de 3.700 a 4.500 vagas ativas, das quais cerca de 950 nacionais.
  - **Fora da lista:** Remotive (só 16 vagas e o robots.txt proíbe `/api`), Gupy e Coodesh (termos proíbem). Arbeitnow e Working Nomads ficam como reserva.
- *Especialista: fontes.*

### D-08: Enriquecimento isomórfico em `lib/shared/stacks.ts`

- **Decisão:**
  - **Dicionário de stacks:** cada uma tem `id` canônico, `synonyms`, `category`, `weight` e `implies` (por exemplo, `nextjs` implica `react`). O dicionário é versionado em `STACKS_VERSION`.
  - **Reuso:** o mesmo módulo serve à ingestão, no servidor, e à normalização das skills do perfil, no cliente.
  - **Origem e "aceita Brasil" (RN-03):** um país estruturado tem prioridade sobre o texto livre.
    - Vaga de empresa estrangeira remota "no Brasil" (como o `geo=brazil` do Jobicy) é classificada como **internacional + `accepts_brazil`**.
    - Uma vaga só é **nacional** se o país for o Brasil e a empresa ou o local forem brasileiros.
  - **Idioma (RN-08):** detectado com `franc-min` na ingestão, limitado a `por`, `eng` e `spa`, para textos com mais de 200 caracteres. Fora disso fica `unknown`, tratado como pt-BR no cliente.
  - **Senioridade:** detectada por palavras-chave no título (estagiário/intern, júnior, pleno/mid, sênior, lead/staff/principal).
- *Especialistas: IA e fontes.*

### D-09: localStorage com schema versionado lido via `useSyncExternalStore`

- **Decisão:**
  - **Chaves:** `jobfind:v1:{settings,profile,jobState,aiAnalysis,generatedDocs,savedFilters,lastVisit}`.
  - **Validação e migração:** todo valor passa pelo Zod `.strict()` na leitura. Migrações `vN→vN+1` são aplicadas na inicialização.
  - **Hidratação:** o `getServerSnapshot` retorna `null`, e a interface mostra um skeleton enquanto isso (evita erro de hidratação). O evento `storage` sincroniza as abas.
  - **Falhas do storage:** os erros de cota e de storage indisponível (como no Safari privado) são tratados.
  - **Limite de tamanho (RNF-10):** acima de 4 MB, a interface pede para exportar os dados e limpar CVs antigos. Os PDFs nunca são guardados, só o JSON que os gera.
  - **Exportação e importação (RF-20):**
    - arquivo de até 5 MB, com Zod estrito;
    - o conteúdo é sanitizado de novo na importação;
    - se o arquivo trouxer uma chave do OpenRouter, a interface pede confirmação mostrando os 4 últimos caracteres (SEC-10);
    - a exportação vem sem a chave por padrão (SEC-11).
- *Especialistas: arquitetura e segurança.*

### D-10: OAuth PKCE do OpenRouter como caminho recomendado, com "colar chave" nos demais provedores

> Revisada em 2026-11-23: com o suporte multi-provedor (D-17), o PKCE vale para o OpenRouter, o único provedor que gera uma chave com limite de gasto por app. Nos outros provedores o usuário cola a chave, e a interface orienta a criar uma chave de projeto com limite de gasto.

- **Contexto:** a chave do usuário fica no localStorage e um XSS poderia lê-la. Trocar o armazenamento não protege, porque a chave precisa virar texto puro no header de qualquer jeito.
- **Opções:**
  - A) Só colar a chave.
  - B) PKCE, gerando uma chave dedicada ao app, com limite de crédito e expiração.
  - C) Guardar a chave no IndexedDB com uma CryptoKey não extraível. É teatro de segurança.
- **Decisão:** **B, mantendo A como alternativa.**
  - O botão leva a `openrouter.ai/auth?callback_url=…/configuracoes/callback&code_challenge=…&code_challenge_method=S256&limit=5&expiration=1-year`.
  - O `code_verifier` fica no `sessionStorage`.
  - No callback, o app chama `POST /api/v1/auth/keys` e limpa o `code` da URL com `history.replaceState`.
  - O "Testar conexão" faz uma chamada com `max_tokens: 5`.
  - "Remover chave" apaga a chave do armazenamento.
- **Consequências:**
  - O dano de uma chave roubada fica limitado a US$ 5, valor que o usuário pode ajustar.
  - Uma resposta 401 depois da expiração dispara o fluxo "Reconectar".
- *Especialistas: IA e segurança.*

### D-11: AI SDK 7 no cliente, atrás de uma fachada `lib/client/ai`

> Os parâmetros abaixo são os do OpenRouter, o provedor padrão. Os demais provedores entram pelo registro da D-17, que reaproveita a mesma fachada, os mesmos prompts e o mesmo validador da RN-07.

- **Opções:**
  - A) `fetch` puro com um parser de SSE próprio.
  - B) `@openrouter/sdk`.
  - C) `openai` com outra `baseURL`.
  - D) AI SDK 7 (`ai`) com `@openrouter/ai-sdk-provider`.
- **Decisão:** **D**, carregado com `import()` só nas telas de IA.
  - A geração usa `streamText` com `Output.object({ schema })`, com saída parcial durante o streaming e validação Zod no final.
  - Se o spike mostrar problemas com erros no meio do stream (que chegam com HTTP 200) ou com `require_parameters`, trocamos por A sem mexer nas telas.
- **Parâmetros padrão de cada chamada:**
  - `model: "deepseek/deepseek-v4.1-flash"`, com `models: [..., "deepseek/deepseek-v4-flash"]` como fallback;
  - `provider: { require_parameters: true, data_collection: "deny" }`;
  - `response_format: json_schema` com `strict: true`;
  - `reasoning: { effort: "low" }`;
  - `max_tokens` por prompt;
  - headers `HTTP-Referer` e `X-OpenRouter-Title`.
- **Seletor de modelo:** a lista vem do `GET /api/v1/models`, que é público, com os modelos `deepseek/*` em destaque. O `deepseek-v4-pro` aparece como opção de "qualidade".
- **Erro 503 (nenhum provedor atende):** o app explica o motivo e oferece desligar o `data_collection: deny` para essa chamada, com um aviso de privacidade explícito.
- **Prompts:** ficam versionados em `lib/client/ai/prompts/{profile.extract,job.fit,cv.tailor}.v1.ts`, cada um com `system`, `buildUser` e `schema`.
  - Os dados da vaga entram dentro de delimitadores com um ID aleatório por chamada, e o texto é truncado: vaga com no máximo 12 mil caracteres, currículo com no máximo 30 mil.
  - Cada resultado guarda o `model` real usado e a `promptVersion`.
- **RN-07 (não inventar fatos) em três camadas:**
  1. **Schema:** o modelo só devolve `expId` e bullets reescritos com `sourceBulletIds`. Empresa, cargo e datas são montados pelo cliente a partir do perfil.
  2. **Validador determinístico:** confere que os `expId` e as skills existem no perfil. Também roda o extrator de stacks sobre os bullets e a carta. Anos, números ou nomes próprios que não estão na fonte geram alerta.
  3. **Reação a alertas:** faz 1 nova tentativa enviando as violações. Se o alerta persistir, o trecho fica destacado no editor e fora do PDF até o usuário aprovar.
- **Minimização de dados:** e-mail, telefone e endereço não são enviados ao modelo. O template do PDF preenche esses campos localmente.
- **Custo estimado:** menos de US$ 0,01 por operação (P1 ≈ 0,0007, P2 ≈ 0,0004, P3 ≈ 0,001, com raciocínio baixo).
- *Especialista: IA.*

### D-12: Extração de PDF com `unpdf`, de DOCX com `mammoth`, tudo no cliente

- **Decisão:**
  - **PDF:** `unpdf` (que embute o pdf.js 6.5 com worker inline e dispensa configuração no bundler).
  - **DOCX:** `mammoth.extractRawText`, nunca `convertToHtml`.
  - **Carregamento:** as duas libs são carregadas com `import()` só na tela de Perfil.
  - **Limites (SEC-09):**
    - até 5 MB;
    - checagem dos magic bytes (`%PDF-` e `PK\x03\x04`);
    - até 10 páginas;
    - até 30 mil caracteres;
    - timeout de 15 s.
  - **PDF escaneado:** o arquivo é tratado como escaneado se tiver menos de 200 caracteres, menos de 100 caracteres por página ou mais de 30% de caracteres inválidos. Nesse caso a interface abre o campo "colar texto".
  - **Versão mínima:** pdf.js 4.2.67 ou superior, por causa do CVE-2024-4367.
- **Alternativa:** usar o `pdfjs-dist` com um worker dedicado, se travar a interface na thread principal se mostrar um problema na prática.
- *Especialistas: IA e segurança.*

### D-13: Score local com breakdown e filtro de chance aplicado no cliente

- **Decisão:**
  - **Cálculo:** a RN-06 vira `Σ wᵢ·sᵢ / Σ wᵢ` sobre os critérios disponíveis, o que redistribui o peso automaticamente quando falta algum dado.
  - **Aderência de stack:**
    - stacks que aparecem no título valem 2 vezes mais;
    - stacks genéricas (git, sql) valem metade;
    - stacks adjacentes (TS↔JS) recebem crédito parcial de 0,5;
    - os anos de experiência ou o nível na stack multiplicam o resultado por um fator entre 0,6 e 1.
  - **Retorno:** `{ score, band, breakdown[] }`, usado no "por que essa nota" (R-07).
  - **Filtro de chance:** como depende do perfil, que só existe no navegador, é aplicado no cliente. O cliente pede `limit=90` e busca mais páginas até preencher 30 itens ou chegar a 5 requisições.
- *Especialistas: IA e arquitetura.*

### D-14: PDF gerado com `@react-pdf/renderer`

- **Opções:**
  - A) `@react-pdf/renderer`.
  - B) pdfmake.
  - C) jsPDF, cujo `html()` vira imagem e não serve para ATS.
  - D) `window.print`, sem controle sobre nome do arquivo e margens.
- **Decisão:** **A**, carregado com `next/dynamic({ ssr: false })`.
  - Fontes Inter ou Noto Sans (TTF regular e bold) registradas com `Font.register`, para cobrir os acentos.
  - Um template de coluna única, compatível com ATS, no MVP (Q-04 do PRD). Um segundo template fica como Should.
  - Pré-visualização com `pdf(doc).toBlob()` num iframe, atualizada com debounce de 500 ms.
  - Aviso quando o documento passar de 2 páginas.
  - Nome do arquivo: `CV-<Nome>-<Empresa>-<cargo>.pdf`, sanitizado.
- **Teste de round-trip:** o E2E extrai o texto do PDF gerado com o próprio `unpdf` e compara com o conteúdo esperado.
- **Plano B gratuito:** `window.print`.
- *Especialista: IA.*

### D-15: CSP por hash/SRI com páginas estáticas, headers de segurança e sanitização em duas camadas

- **Contexto:** um XSS rouba a chave e o currículo. Uma CSP com nonce forçaria todas as páginas a serem dinâmicas, o que vai contra a D-01 e as cotas.
- **Decisão:**
  - **CSP:**
    - Usar `experimental.sri` do Next, que gera hashes e SRI no build, com a CSP aplicada pelo `headers()` do `next.config`.
    - Se o spike mostrar incompatibilidade, cair para nonce nas rotas `(local)` e reavaliar o custo.
    - Diretivas:
      ```
      default-src 'self'; script-src 'self' <hashes> 'strict-dynamic';
      style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:;
      font-src 'self' data:; connect-src 'self' <hosts dos provedores de IA, ver D-17>;
      worker-src 'self' blob:; frame-src blob:; object-src 'none';
      base-uri 'none'; form-action 'self'; frame-ancestors 'none';
      upgrade-insecure-requests
      ```
    - `'wasm-unsafe-eval'` só entra se o `@react-pdf` exigir.
    - `img-src https:` fica liberado por causa dos logos das empresas, que são exibidos direto da origem com `<img referrerpolicy="no-referrer">`. O servidor nunca baixa as imagens, o que evita SSRF.
  - **Sanitização em duas camadas:**
    1. Na ingestão, `sanitize-html` com allowlist (sem `img`, `style`, `on*` ou `svg`; esquemas permitidos: `http`, `https` e `mailto`). Os links recebem `rel="noopener noreferrer nofollow"`, exceto o RemoteOK, que exige link dofollow. A versão do sanitizador fica gravada em `sanitizer_version`.
    2. No cliente, DOMPurify antes de qualquer `dangerouslySetInnerHTML`, inclusive para os snapshots guardados no localStorage.
  - **Saída da IA:** é renderizada sempre como texto, nunca como Markdown ou HTML. Isso evita exfiltrar dados por uma imagem com URL externa.
  - **Headers:** HSTS, `nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restritiva, `COOP: same-origin` e `X-Frame-Options: DENY`. Nenhum CORS nas rotas `/api`.
  - **Segredo do cron:** é verificado no próprio route handler, e não no middleware (por causa do CVE-2025-29927), comparando o `sha256` com `timingSafeEqual`.
- **Requisitos SEC-01 a SEC-12:** adotados conforme o relatório de segurança, resumidos na seção 5.4.
- *Especialista: segurança.*

### D-16: UI com Tailwind v4, shadcn/ui, TanStack Query e nuqs

- **Decisão:**
  - shadcn/ui, baseado em Radix, para acessibilidade (WCAG AA).
  - nuqs para guardar os filtros na URL (RF-09).
  - `useInfiniteQuery` do TanStack Query para a lista.
  - Abas com contadores.
  - Layout responsivo a partir de 360 px.
- **Descartado:** SWR, porque a paginação infinita com refetch condicional fica menos natural nele.
- *Especialista: arquitetura.*

### D-17: IA multi-provedor (BYOK) chamada direto do navegador, sem proxy

- **Contexto:** o usuário quer que cada pessoa use qualquer IA de uso pessoal. Em 23/11/2026 testamos o preflight CORS de 17 provedores em nuvem e todos aceitam chamadas diretas do navegador com a chave do usuário. A Anthropic exige o header `anthropic-dangerous-direct-browser-access: true`. Fireworks e Mistral recusam headers extras no preflight.
- **Opções para provedores sem CORS:**
  - A) Não suportar.
  - B) Proxy stateless no Next.
- **Decisão:** **A**, porque nenhum provedor testado precisa de proxy. O proxy (B) viraria um proxy aberto, abriria SSRF com `baseURL` livre, gastaria a cota de 4 h/mês de CPU com streaming e faria o currículo passar pelo servidor, quebrando a RN-11.
- **Registro de provedores:** fica em `lib/client/ai/providers.ts` e cada provedor tem `id`, `label`, `baseURL`, `sdkFactory` (com `import()` sob demanda), `cors` (`yes` | `needs-header` | `local-config`), `structured` (`json_schema` | `tool` | `json_mode`), `listModels`, `keyDocsUrl`, `defaultModel` por tarefa, `auth` (`pkce` | `paste`), `privacyNote` e `cspHosts`. O registro alimenta o `createProviderRegistry` do AI SDK.
- **Pacotes:**
  - Provedores com pacote dedicado: OpenRouter, OpenAI, Anthropic (`structuredOutputMode: 'auto'`), Google e Mistral.
  - Provedores via `@ai-sdk/openai-compatible`: DeepSeek, Groq, Cerebras, xAI, Together, Fireworks, Hugging Face, Vercel AI Gateway, Ollama e LM Studio.
- **Provedores por prioridade:**
  - **Must:** OpenRouter (PKCE, recomendado), OpenAI, Anthropic, Google Gemini, DeepSeek e IA local (Ollama/LM Studio, marcada como experimental).
  - **Should:** Groq, Mistral, Cerebras, xAI, Together, Fireworks, Hugging Face e Vercel AI Gateway. Saem quase de graça pelo `openai-compatible`.
  - **Depois:** Azure OpenAI e Amazon Bedrock, porque o host varia por recurso/região e complica a CSP.
  - **Fora:** Perplexity, que é focada em busca na web e ruim para extração.
- **Saída estruturada com fallback:**
  1. `json_schema` strict quando o provedor suporta.
  2. Senão, tool calling forçado.
  3. Senão, JSON mode com o schema no system prompt.
  4. Sempre: validação Zod e `jsonrepair` antes de declarar falha.
  - **Limite de chamadas:** no máximo 2 chamadas por operação, somando a retentativa do Zod e a da RN-07.
  - **Testes:** um teste de contrato por provedor no spike.
- **Chaves no localStorage:** a chave `jobfind:v1:ai` guarda `{ providers: { <id>: { key, baseURL?, addedAt, source: 'pkce'|'paste' } }, tasks: { extract, analyze, cv: { provider, model } } }`. A chave nunca vai para URL nem log. Cada resultado grava o `provider/model` real que foi usado.
- **CSP (`connect-src`):** uma lista fixa gerada a partir dos `cspHosts` do registro: `openrouter.ai`, `api.openai.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`, `api.deepseek.com`, `api.mistral.ai`, `api.groq.com`, `api.x.ai`, `api.together.xyz`, `api.fireworks.ai`, `api.cerebras.ai`, `router.huggingface.co`, `ai-gateway.vercel.sh`, mais `http://127.0.0.1:*` e `http://localhost:*`.
  - O "endpoint compatível com OpenAI" genérico só aceita loopback e os hosts da lista. Liberar `https:` inteiro exigiria uma nova decisão registrada.
  - Adicionar um provedor novo é um PR no registro, o que também atualiza a CSP.
- **IA local:**
  - **Chrome:** desde a versão 142 exige o Local Network Access, com permissão de loopback após um gesto do usuário e `fetch(..., { targetAddressSpace: 'loopback' })` por meio de um `fetch` customizado.
  - **Configuração do usuário:** liberar CORS no servidor local (`OLLAMA_ORIGINS=https://<domínio>` ou `--cors` no LM Studio), com um guia na interface. Usar `127.0.0.1`.
  - **Suporte:** "best effort", marcado como experimental. O Safari teve regressões com loopback.
- **Privacidade por provedor:** aviso com confirmação no primeiro uso do plano gratuito do Gemini (os dados podem ser usados para treino), do DeepSeek direto (servidores na China) e de modelos `:free`. A RN-07 vale igualmente para modelos locais.
- *Especialistas: provedores de IA e segurança.*

### D-18: Repositório open-source público com licença MIT

- **Decisão:**
  - **Repositório:** `github.com/jaaymes/job-find`, criado público em 23/11/2026.
  - **Licença:** MIT, a mais simples para estimular contribuições e forks de quem quer rodar a própria instância.
  - **Arquivos de comunidade:**
    - README em pt-BR (o que é, como usar, privacidade, como rodar);
    - `CONTRIBUTING.md` com os guias "adicionar uma fonte" (interface do conector, fixtures, teste de contrato, checagem de ToS em `docs/fontes.md`) e "adicionar um provedor de IA" (entrada no registro da D-17 e host na CSP);
    - `CODE_OF_CONDUCT.md`;
    - templates de issue e PR.
  - **Self-host:** `.env.example` com as 4 variáveis aprovadas e um guia de deploy na Vercel com Neon.
  - **Segurança da cadeia de dependências:** CI obrigatório nos PRs, Dependabot, actions fixadas por SHA e `permissions: {}` por padrão (SEC-08). Nenhum segredo entra no repositório.
- **Consequências:** o código público facilita auditoria, mas expõe a lista de fontes e a lógica de coleta. Isso é aceitável, porque todas as fontes são abertas.
- *Decisão do usuário (2026-11-23).*

**Eixos sem impacto:**
- Multi-tenant e autorização por perfil: não há login.
- Filas dedicadas: a coleta cabe numa invocação com `after()`.
- Tempo real e fan-out entre instâncias.

## 5. Design

### 5.1 Fluxos

```mermaid
flowchart LR
  S[Vercel Schedules :17/h] -->|Bearer CRON_SECRET| C[/api/cron/collect]
  C -->|allSettled, conc. 5, 20s/fonte| F[(Fontes abertas)]
  C -->|upsert + expiração| DB[(Neon Postgres)]
  C -->|invalidateByTag jobs| CDN[(Vercel CDN)]
  B[Navegador] -->|GET /api/jobs canônico| CDN --> A[/api/jobs] --> DB
  B -->|PKCE / chat completions| OR[OpenRouter → DeepSeek]
  B --- LS[(localStorage: perfil, chave, estados, docs)]
```

**Fluxos de falha:**

| Falha | Comportamento |
|---|---|
| Fonte fora do ar | O `source_runs` registra `error`, a fonte mantém as vagas e incrementa `consecutive_failures` |
| Neon suspenso | A CDN serve conteúdo antigo via `stale-if-error`, e a coleta falha e fica registrada |
| OpenRouter 401 | Fluxo "Reconectar" |
| OpenRouter 402 | Aviso para recarregar créditos |
| OpenRouter 403 | Mostra o limite de crédito da chave atingido |
| OpenRouter 429/502/408 | Até 2 retentativas com backoff, depois botão "Tentar de novo" |
| Erro no meio do stream (HTTP 200) | Tratado como 502 |
| `finish_reason: length` | Uma nova tentativa com `max_tokens` maior |

### 5.2 Dados (migração `0001_init.sql`)

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

CREATE OR REPLACE FUNCTION job_search_vector(p_title text, p_company text, p_stacks text[], p_lang text, p_body text)
RETURNS tsvector LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT setweight(to_tsvector('simple', f_unaccent(coalesce(p_title,'')||' '||coalesce(p_company,'')||' '||array_to_string(p_stacks,' '))), 'A')
      || setweight(to_tsvector(CASE p_lang WHEN 'pt' THEN 'portuguese' WHEN 'en' THEN 'english'
                                           WHEN 'es' THEN 'spanish' ELSE 'simple' END::regconfig,
                               f_unaccent(coalesce(p_title,'')||' '||left(coalesce(p_body,''),20000))), 'C')
$$;

CREATE TABLE jobs (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dedupe_key        text NOT NULL,
  url_canonical     text NOT NULL,
  title             text NOT NULL,
  company           text NOT NULL,
  company_logo_url  text,
  summary           text NOT NULL DEFAULT '',
  description_html  text NOT NULL CHECK (octet_length(description_html) <= 30000),
  sanitizer_version smallint NOT NULL,
  country           char(2),
  city              text,
  origin            text NOT NULL DEFAULT 'unknown' CHECK (origin IN ('national','international','unknown')),
  accepts_brazil    boolean,
  work_mode         text NOT NULL DEFAULT 'unknown' CHECK (work_mode IN ('remote','hybrid','onsite','unknown')),
  seniority         text CHECK (seniority IN ('intern','junior','mid','senior','lead')),
  language          text NOT NULL DEFAULT 'unknown',
  stacks            text[] NOT NULL DEFAULT '{}',
  sources           text[] NOT NULL DEFAULT '{}',
  salary_min        numeric(12,2), salary_max numeric(12,2),
  salary_currency   char(3), salary_period text CHECK (salary_period IN ('hour','month','year')),
  published_at      timestamptz NOT NULL,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  content_hash      text NOT NULL,
  expired_at        timestamptz,
  search_vector     tsvector NOT NULL
);
CREATE UNIQUE INDEX jobs_dedupe_active_uq ON jobs (dedupe_key)    WHERE expired_at IS NULL;
CREATE UNIQUE INDEX jobs_url_active_uq    ON jobs (url_canonical) WHERE expired_at IS NULL;
CREATE INDEX jobs_feed_idx      ON jobs (published_at DESC, id DESC)            WHERE expired_at IS NULL;
CREATE INDEX jobs_mode_feed_idx ON jobs (work_mode, published_at DESC, id DESC) WHERE expired_at IS NULL;
CREATE INDEX jobs_stacks_gin    ON jobs USING gin (stacks)        WHERE expired_at IS NULL;
CREATE INDEX jobs_sources_gin   ON jobs USING gin (sources)       WHERE expired_at IS NULL;
CREATE INDEX jobs_fts_gin       ON jobs USING gin (search_vector) WHERE expired_at IS NULL;
CREATE INDEX jobs_expired_idx   ON jobs (expired_at)              WHERE expired_at IS NOT NULL;

CREATE TABLE job_sources (
  source text NOT NULL, external_id text NOT NULL,
  job_id bigint NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  url text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  missed_runs   smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (source, external_id)
) WITH (fillfactor = 85);
CREATE INDEX job_sources_job_idx ON job_sources (job_id);

CREATE TABLE source_state (
  source text PRIMARY KEY,
  consecutive_failures int NOT NULL DEFAULT 0,
  last_success_at timestamptz, last_fetched_count int,
  cursor text,                 -- fontes incrementais (Himalayas, Jobicy, GitHub since)
  locked_until timestamptz
);

CREATE TABLE source_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','ok','error','skipped')),
  fetched_count int, new_count int, updated_count int, expired_count int, error text
);
CREATE INDEX source_runs_src_idx ON source_runs (source, started_at DESC);
```

- **Rollback da 0001:** `DROP TABLE source_runs, source_state, job_sources, jobs; DROP FUNCTION job_search_vector, f_unaccent;`.
- **Upsert:** feito com `ON CONFLICT (dedupe_key) WHERE expired_at IS NULL DO UPDATE … WHERE content_hash IS DISTINCT FROM EXCLUDED.content_hash OR NOT (EXCLUDED.sources <@ jobs.sources)`, com `published_at = LEAST(...)`. A expiração e a retenção seguem a D-04.
- **Neon:** o autoscaling fica limitado a 0,25 CU e a suspensão por inatividade fica no padrão de 5 min.

### 5.3 APIs

- `GET /api/jobs`
  - **Parâmetros** (validados com Zod):

    | Parâmetro | Valores |
    |---|---|
    | `q` | até 100 caracteres |
    | `stacks` | até 10 |
    | `stacksMode` | `any` \| `all` |
    | `origin` | `national` \| `international` |
    | `acceptsBrazil` | booleano |
    | `workMode` | modelo de trabalho |
    | `seniority[]` | lista de senioridades |
    | `lang` | idioma da vaga |
    | `since` | `24h` \| `7d` \| `30d` |
    | `source[]` | lista de fontes |
    | `cursor` | opaco: base64url de `published_at\|id` |
    | `limit` | 30 por padrão, até 90 |

  - **Resposta 200:** `{ items: JobSummary[], nextCursor: string|null, counts?: {all,remote,hybrid,onsite}, lastCollectedAt }`.
  - **Erros:** 400 `{ error: { code, message } }`, sem stack trace; 429 vem do WAF.
  - **Ordenação:** sempre `published_at DESC, id DESC`, buscando 31 linhas para saber se existe uma próxima página.
- `GET /api/jobs/[id]` → `Job` com `description_html` sanitizado e `attribution` de cada fonte.
- `POST|GET /api/cron/collect?sources=a,b`
  - **Autenticação:** `Authorization: Bearer <CRON_SECRET>`. Sem segredo ou com segredo errado, 401.
  - **Validação:** a lista de `sources` é checada contra os conectores registrados.
  - **Resposta:** 202 imediato, com a coleta continuando via `after()`.
  - **Idempotência:** o upsert usa a chave `source + external_id`, então repetir a chamada não duplica nada.
- **Página Fontes:** `GET /api/sources/status` com cache de 5 min na CDN, devolvendo `source_state` mais o último `source_runs` de cada fonte (RF-21).

### 5.4 Segurança, performance e operação

| Item | Definição |
|---|---|
| SEC-01 | CSP por hash/SRI, com nonce como fallback (D-15). Verificado por E2E sem violação de CSP no console. |
| SEC-02 | Sanitização em duas camadas, testada com um corpus de payloads XSS. |
| SEC-03 | Validador de URL compartilhado (`lib/shared/url.ts`). `javascript:` é rejeitado na ingestão, na importação e na renderização. |
| SEC-04 | Segredo do cron comparado em tempo constante, mais lock por fonte. |
| SEC-05 | Validação Zod, `statement_timeout` de 3 s, cache na CDN e rate limit no WAF. |
| SEC-06 | Sem SSRF: fetch só para URLs base do código, com redirect manual. |
| SEC-07 | Headers de segurança. |
| SEC-08 | Dependabot e `pnpm audit --audit-level=high` no CI. |
| SEC-09 | Limites de upload. |
| SEC-10 | Importação endurecida. |
| SEC-11 | Exportação sem a chave por padrão. |
| SEC-12 | Nenhum log com dados pessoais; nenhum script de terceiros. |
| Performance | `/api/jobs` p95 ≤ 500 ms sem cache e menos de 50 ms com cache; score de 30 vagas em menos de 1 ms. |
| Operação | Página Fontes com alerta de coleta parada há mais de 3 h; `source_runs` como log; uso de CU-h do Neon e de CPU ativa da Vercel revisado semanalmente. |
| Analytics | Vercel Web Analytics, agregado, sem cookies e com eventos sem dados pessoais (Q-02 do PRD: proposto). |
| LGPD | Página de Privacidade com os pontos do relatório de segurança: o currículo nunca chega ao servidor; transferência ao OpenRouter e à DeepSeek feita pelo próprio titular; logs de IP na Vercel; canal para pedir remoção de dados pessoais de terceiros que aparecem em vagas. Aviso na primeira chamada à IA. |

### 5.5 Variáveis de ambiente (aprovadas em 2026-11-23)

| Variável | Uso | Onde |
|---|---|---|
| `DATABASE_URL` | Conexão com o Neon, criada pela integração do Marketplace | Vercel |
| `CRON_SECRET` | Autenticação da rota de coleta | Vercel |
| `GITHUB_TOKEN` | Token *fine-grained* só de leitura de repositórios públicos, para o conector de issues | Vercel |
| `HIMALAYAS_API_KEY` | Chave gratuita do Himalayas (limite de 60 por minuto) | Vercel |

Não há feature flags: tudo entra ativo.

## 6. Estratégia de testes

| Camada | Ferramenta | Cobre |
|---|---|---|
| Unitário | Vitest 5 | Conectores com fixtures reais (`tests/fixtures/sources/*`), `stacks` (precisão ≥ 90% numa amostra de 100 vagas, RF-04), origem/modo/senioridade/idioma, `dedupe_key` (RN-05), score (RN-06, com casos de redistribuição), validador RN-07, migrações do storage, sanitizadores com corpus XSS (SEC-02), validador de URL (SEC-03), comparação do segredo (SEC-04) |
| Integração | Vitest + Postgres 17 em Docker (service container no CI) | Migração 0001, upsert idempotente, janela de 30 dias, expiração (RF-07), `GET /api/jobs` com cada filtro, cursor e contadores (RF-08/09/10), `statement_timeout` |
| Contrato | Vitest em workflow agendado diário (fora do build) | Payload real de cada fonte validado pelo Zod; slugs dos boards curados que retornam 404 ou vazio |
| E2E | Playwright 1.65 contra `next build && next start`, com OpenRouter mockado via `page.route` | US-01/02 (ordem e filtros na URL), US-03 (PKCE mockado, colar chave, testar, remover), US-04 (fixtures PDF, DOCX e PDF escaneado), US-05 (faixas), US-06 (gerar, editar, baixar e conferir o texto do PDF com `unpdf`), US-07/08 (estados, exportação e importação), ausência de violações de CSP, headers |
| Avaliação de IA | Script manual | 11 pares currículo/vaga (10 + 1 da revisão final da Fase 3) a cada mudança de prompt: nenhum fato inventado, JSON válido, tempos da RNF-02 |
| Manual | — | Leitores de tela nas telas principais (RNF-08), largura de 360 px (RNF-09), nota A no securityheaders.com |

**CI (GitHub Actions):** `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build && pnpm test:e2e`, mais `pnpm audit`.

## 7. Plano de implementação

### Fase 0: Spikes (P)
- **Entrega:** um relatório curto em `docs/tech/spikes.md`.
- **Tarefas:**
  1. Confirmar que o Vercel Schedules envia o `CRON_SECRET` e roda a cada hora no Hobby.
  2. Confirmar que o `experimental.sri` produz uma CSP sem violações com o Next 16.4, o unpdf e o @react-pdf.
  3. Testar o AI SDK 7 no navegador com `json_schema`, `require_parameters` e `data_collection: deny` no v4.1-flash e no v4-flash, com 5 currículos. Validar a qualidade em PT/EN e se ainda sobram provedores (P-02).
  4. Testar o fluxo PKCE com `limit` e `expiration`.
  4b. Rodar o teste de contrato dos provedores Must (OpenAI, Anthropic, Gemini, DeepSeek e Ollama) com chaves reais: CORS, saída estruturada e streaming. Confirmar o json_schema da DeepSeek e o Local Network Access no Chrome.
  5. Medir o desempenho do unpdf na thread principal com um PDF de 10 páginas.
- **Pronto quando:** cada premissa estiver marcada como confirmada ou com o plano B escolhido.

### Fase 1: Índice de vagas (G), o caminho crítico
- **Entrega:** a lista pública funcionando com 5 fontes.
- **Tarefas:**
  - scaffold (Next 16.4, TS strict, Tailwind v4, shadcn, ESLint, CI) no repositório público, com LICENSE (MIT), README, CONTRIBUTING, CODE_OF_CONDUCT, templates e `.env.example` (D-18);
  - Neon (região e limite de CU), Drizzle e migração 0001;
  - `lib/shared/stacks.ts` e o restante do enriquecimento;
  - base comum dos conectores com fetch seguro;
  - conectores Himalayas, Greenhouse, Ashby, Lever e Jobicy;
  - orquestrador (lock, upsert, expiração, retenção, invalidação de cache);
  - `/api/cron/collect` e configuração do Schedules;
  - `lib/server/jobs/query.ts`, `/api/jobs` e `/api/jobs/[id]`;
  - home com abas, filtros (nuqs) e rolagem infinita;
  - detalhe da vaga com atribuição;
  - headers, CSP e regra do WAF;
  - `docs/fontes.md`.
- **Pronto quando:**
  - houver 1.000 ou mais vagas ativas;
  - o atraso p90 da coleta for de até 2 h;
  - a US-01 e a US-02 passarem no E2E;
  - `/api/jobs` tiver p95 ≤ 500 ms sem cache.
- **Depende de:** Fase 0, itens 1 e 2.

### Fase 2: Perfil e chance (M)
- **Tarefas:**
  - store do localStorage;
  - Configurações multi-provedor (cards de provedores, PKCE do OpenRouter, colar chave, testar, remover, modelo por tarefa, avisos de privacidade), seguindo a tela "Configurações de IA" do protótipo;
  - `lib/client/ai` (fachada, registro de provedores da D-17, fallback de saída estruturada, mapa de erros por provedor);
  - provedores Must (OpenRouter, OpenAI, Anthropic, Gemini, DeepSeek, IA local experimental) e Should via `openai-compatible`;
  - extração de PDF/DOCX/texto;
  - prompt P1 e editor de perfil;
  - score com breakdown e filtro de chance;
  - prompt P2 com cache por vaga.
- **Pronto quando:** a US-03, a US-04 e a US-05 passarem.
- **Depende de:** Fase 0, item 3, e da Fase 1 (lista).

### Fase 3: CV e carta (G)
- **Tarefas:**
  - prompt P3;
  - validador RN-07 com nova tentativa;
  - editor;
  - template ATS no @react-pdf com fontes;
  - pré-visualização;
  - seletor de idioma;
  - avaliação com os 11 pares (o 11º, com perfil abaixo da senioridade da vaga, entrou na revisão final).
- **Pronto quando:** a US-06 passar e a avaliação não encontrar nenhum fato inventado.
- **Depende de:** Fase 2.

### Fase 4: Organização, robustez e mais fontes (M)
- **Tarefas:**
  - favoritos, ocultar, status e Minhas vagas;
  - exportação e importação;
  - página Fontes;
  - Privacidade;
  - conectores GitHub, WWR, RemoteOK e HN (SmartRecruiters se for confirmado);
  - testes de contrato agendados;
  - filtros salvos e selo "Nova".
- **Pronto quando:**
  - a US-07 e a US-08 passarem;
  - houver 10 ou mais fontes ativas;
  - houver 3.000 ou mais vagas ativas e 800 ou mais nacionais.
- **Depende de:** Fase 1. Pode rodar em paralelo com as Fases 2 e 3, porque toca arquivos diferentes: `lib/server/sources` e as páginas `(local)/minhas-vagas`.

**Caminho crítico:** Fase 0 → Fase 1 → Fase 2 → Fase 3. Os conectores da Fase 4 podem começar assim que a base dos conectores da Fase 1 estiver pronta.

### Rollout e rollback
- Os deploys vão direto para a Vercel. O rollback do código usa o Instant Rollback.
- O banco só recebe migrações expand/contract, porque o rollback do código não reverte o banco.
- Mudanças de schema do localStorage usam migrações `vN→vN+1` que nunca apagam dados. A exportação fica disponível antes de qualquer migração destrutiva.
- Uma fonte problemática é desativada removendo-a do registro de conectores, num deploy de uma linha.

## 8. Riscos

| Risco | Prob. | Impacto | Mitigação |
|-------|-------|---------|-----------|
| Estourar as 100 CU-h/mês do Neon, o que suspende o banco até o próximo mês | Média | Alto | CDN com `max-age` de 900 s e `stale-if-error`, URLs canônicas, CU limitado a 0,25, nenhuma página dinâmica, revisão semanal do uso. Se chegar a 70% do uso, aumentar o `max-age` ou considerar o plano pago |
| Estourar as 4 h/mês de CPU ativa da Vercel | Média | Alto | Sanitizar só quando o conteúdo muda, páginas estáticas, coleta concentrada em espera de rede |
| XSS rouba a chave e o currículo | Baixa | Alto | D-15 (CSP, sanitização em duas camadas, saída da IA renderizada como texto), chave PKCE com limite de US$ 5 |
| Fonte muda de formato ou bloqueia o acesso | Alta | Médio | Conectores isolados, Zod, testes de contrato diários, página Fontes |
| Volume nacional abaixo de 800 vagas | Média | Médio | Ampliar a curadoria para 40 ou mais boards brasileiros; pedir autorização a Remotar, Programathor e Gupy (ação do produto) |
| Vercel Schedules em beta muda ou sai do ar | Média | Médio | Plano B com GitHub Actions já documentado; alerta de coleta parada há mais de 3 h |
| `data_collection: deny` combinado com `require_parameters` não deixa nenhum provedor | Média | Médio | Spike da Fase 0; fallback explícito com aviso |
| A IA inventa fatos no CV | Média | Alto | Validador determinístico em três camadas (D-11) |
| `experimental.sri` instável | Média | Médio | Fallback para nonce só nas rotas `(local)` |
| Risco aceito: as rotas públicas mantêm `script-src 'unsafe-inline'` (D-15) e `/vagas/[id]` lê as chaves e o perfil do localStorage para a análise com IA | Baixa | Alto | O localStorage é por origem, então um XSS em qualquer rota pública alcançaria os dados de qualquer jeito. Mitigação: DOMPurify mais saída da IA renderizada só como texto. A solução completa seria nonce em todas as rotas, ao custo de tornar as páginas dinâmicas (viola RNF-11); aceito |
| Mais chaves no localStorage, e só o OpenRouter limita gasto por app | Média | Alto | D-15 contra XSS; OpenRouter recomendado; a interface orienta a criar chave de projeto com limite de gasto |
| Provedores mudam CORS, IDs de modelo ou formato de erro | Alta | Médio | Teste de contrato por provedor, modelos vindos do `listModels`, padrões atualizáveis por PR |
| IA local bloqueada pelo navegador (LNA, Safari) | Média | Baixo | Marcada como experimental, com guia e mensagem de erro clara |
| Termos do Hobby proíbem uso comercial | Baixa | Médio | Pergunta em aberto; migrar para o Pro se o produto for monetizado |

## 9. Premissas e perguntas em aberto

**Premissas:**
- P-01: o OpenRouter aceita chamadas do navegador (CORS). **Confirmada** em 23/11/2026 com um preflight real.
- P-02: o DeepSeek v4.1-flash gera JSON confiável e bom texto em PT/EN. Validar na Fase 0.
- O Vercel Schedules envia o `CRON_SECRET`. Validar na Fase 0.
- `experimental.sri` funciona com as libs escolhidas. Validar na Fase 0.

**Perguntas** (responsável / fase que bloqueia):

| # | Pergunta | Responsável | Bloqueia |
|---|---|---|---|
| 1 | Enviar e-mails pedindo autorização a Remotar, Programathor, WWR (sobre armazenar o RSS), Working Nomads e Gupy? | Jaymes | Fase 4 (volume) |
| 2 | O produto será monetizado? Os termos do Hobby podem exigir o plano Pro | Jaymes | Lançamento |
| 3 | ~~O repositório vai ser público ou privado?~~ Respondida: público (D-18) | — | — |
| 7 | O endpoint "compatível com OpenAI" genérico deve aceitar qualquer host HTTPS? Isso afrouxa a CSP (proposto: não, só loopback e a lista fixa) | Jaymes | Fase 2 |
| 4 | Qual o valor padrão de `limit` no PKCE (proposto: US$ 5) e da expiração (proposto: 1 ano)? | Jaymes | Fase 2 |
| 5 | A RN-07 bloqueia números e métricas não encontrados, ou só alerta? (Proposto: alerta, e o trecho só entra no PDF com aprovação do usuário) | Jaymes | Fase 3 |
| 6 | Qual o canal de contato da LGPD e o domínio (Q-05 do PRD)? | Jaymes | Lançamento |

## 10. Histórico

| Data | Mudança | Autor |
|------|---------|-------|
| 2026-11-23 | Versão inicial, consolidando os relatórios dos especialistas em arquitetura, fontes, IA/documentos e segurança. Decisões do usuário: as 4 variáveis de ambiente aprovadas, Vercel Schedules, CSP por hash/SRI e meta de 800 ou mais vagas nacionais | Tech Lead (IA) |
| 2026-11-23 | Nova D-17 (IA multi-provedor BYOK, sem proxy) e D-18 (repositório open-source MIT); D-10, D-11 e D-15 revisadas; link do protótipo no Claude Design; riscos e fases atualizados | Tech Lead (IA) |
