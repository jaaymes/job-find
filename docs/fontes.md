# Fontes de vagas

Registro das fontes de vagas do Job Find (RN-09 do PRD, D-07 da spec técnica). Cada conector fica em `lib/server/sources/<fonte>.ts` e é registrado em `lib/server/sources/registry.ts`, que também define a atribuição exibida na interface.

Regras comuns a todos os conectores:

- O fetch só vai para o host fixo declarado em `allowedHosts` (URL base definida no código), com timeout de 20 s, resposta de até 10 MB e `redirect: 'manual'` (até 3 saltos, cada um revalidado).
- A coleta roda de hora em hora (`17 * * * *`, ver `vercel.json`), e cada conector respeita `minIntervalMinutes`.
- **Snapshot completo (`fullSnapshot: true`):** a resposta lista todas as vagas abertas, então as que sumiram podem expirar. **Incremental (`false`):** a fonte só devolve as mais novas e o cursor guarda onde a coleta parou; a ausência de uma vaga não a expira.
- Lista vazia ou parcial com HTTP 200 não expira vagas da fonte.

## Fontes implementadas (Fase 1)

| Fonte | Endpoint | ToS (link e data da checagem) | Atribuição exigida | `fullSnapshot` | Limites |
|---|---|---|---|---|---|
| Himalayas | `https://himalayas.app/jobs/api` (paginação por cursor, `limit=20`, `Authorization: Bearer $HIMALAYAS_API_KEY` quando definida) | [Docs da API](https://himalayas.app/docs/remote-jobs-api), checada em 2026-11-23: exibir crédito visível com link para himalayas.app, citando o Himalayas como fonte; usar o `applicationLink` da API; pode exibir as vagas no próprio site sem pedir permissão; não repassar a outros job boards, agregadores, Google Jobs ou LinkedIn Jobs (inclui feeds e dados estruturados `JobPosting`). Os termos completos da API (`himalayas.app/terms#api`) não foram lidos: a confirmar | Link visível para o Himalayas; `applicationLink` intacto; não repassar a agregadores nem ao Google. Registro: rótulo "Himalayas", sem dofollow | Não (incremental por cursor/guid) | 60 req/min na API gratuita; máximo de 25 páginas (500 vagas) por coleta; intervalo mínimo de 60 min |
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true` | A confirmar. [Docs da Job Board API](https://docs.greenhouse.io/job-board.html), checada em 2026-11-23: endpoints de leitura sem autenticação e sujeitos a rate limit sem valor publicado; a página não traz termos de uso, atribuição nem regras de reuso | Link para a vaga (decisão da spec, não exigência confirmada). Registro: rótulo "Greenhouse", sem dofollow | Sim | 19 boards curados (abaixo); até 3 requisições simultâneas; board fora do ar é ignorado, e só falha se todos falharem |
| Ashby | `https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true` | A confirmar. [Docs da API pública](https://developers.ashbyhq.com/docs/public-job-posting-api), checada em 2026-11-23: a página não traz termos, atribuição nem rate limit | Link para a vaga (decisão da spec, não exigência confirmada). Registro: rótulo "Ashby", sem dofollow | Sim | 12 boards curados (abaixo); até 3 requisições simultâneas |
| Lever | `https://api.lever.co/v0/postings/<slug>?mode=json` | A confirmar. [Postings API](https://github.com/lever/postings-api), checada em 2026-11-23: vagas `published` são públicas; a página não traz termos de uso nem atribuição (o limite de 2 POST/s vale só para candidaturas) | Link para a vaga (decisão da spec, não exigência confirmada). Registro: rótulo "Lever", sem dofollow | Sim | 5 boards curados (abaixo); até 3 requisições simultâneas |
| Jobicy | `https://jobicy.com/api/v2/remote-jobs?count=50&industry=engineering&geo=brazil` e `geo=latam` | [Docs da API/feed](https://jobicy.com/jobs-rss-feed), checada em 2026-11-23: uso em produtos próprios sem pedir permissão, inclusive comercial; armazenar e cachear é permitido se vagas fechadas ou expiradas forem marcadas como indisponíveis; o Jobicy deve ser creditado como fonte original, sem apagar a atribuição. Os Termos de Serviço (`jobicy.com/terms-and-conditions`) não foram lidos: a confirmar | Crédito com link para o Jobicy; candidatura pelo link do Jobicy. Registro: rótulo "Jobicy", sem dofollow | Não (incremental, janela de 7 dias) | 50 vagas por consulta (2 consultas, ids duplicados descartados); a doc pede no máximo 1 requisição/s por IP e cache, e o projeto coleta no máximo 1 vez por hora (`minIntervalMinutes: 60`). Atenção: a doc atual cita `GET /api/jobs`, enquanto o conector usa `/api/v2/remote-jobs`; verificar se o caminho ainda vale |
| GitHub issues | `https://api.github.com/repos/<dono>/<repo>/issues?state=open&per_page=100&page=<n>` (opcional: `Authorization: Bearer $GITHUB_TOKEN`) | [Docs da REST API de issues](https://docs.github.com/en/rest/issues/issues), checada em 2026-11-23: a API pública é de leitura livre e sujeita a rate limit; os Termos de Uso da API do GitHub não foram lidos: a confirmar. Cada issue é conteúdo de terceiros publicado em repositório público | Link para a issue (decisão da spec). Registro: rótulo "GitHub", sem dofollow | Sim (só issues abertas; issue fechada some da lista e expira em 3 coletas pela regra do runner) | 5 repositórios curados (abaixo); até 3 repositórios simultâneos; só `state=open`, 100 por página, no máximo 5 páginas por repositório; pull requests são descartados; 60 req/h sem token e 5.000 req/h com `GITHUB_TOKEN` (nunca registrado em log); intervalo mínimo de 60 min; fonte brasileira |
| We Work Remotely | RSS `https://weworkremotely.com/categories/remote-programming-jobs.rss` e `remote-devops-sysadmin-jobs.rss` | Termos não lidos: a confirmar. A spec (D-07) pede confirmar a permissão de uso do feed por e-mail antes de ir a produção; o feed RSS é público e não traz termos de uso no próprio XML (checado em 2026-11-23) | "via We Work Remotely" com link para a vaga (página do We Work Remotely). Registro: rótulo "We Work Remotely", sem dofollow | Sim | 2 feeds de categorias tech, lidos em sequência; vagas repetidas entre feeds são descartadas pelo `guid`; feed fora do ar é ignorado e reportado, e só falha se todos falharem; `region` vira `eligibleRegions`; intervalo mínimo de 60 min; sem dependência de XML (parser estrito de `<item>` que aceita CDATA) |
| RemoteOK | `https://remoteok.com/api` (o item [0] é o aviso legal e é ignorado) | Termos da API, no item [0] da própria resposta (checados em 2026-11-23): linkar de volta, com follow e sem `nofollow`, para a URL da vaga no RemoteOK e citar o RemoteOK como fonte; sem isso o acesso à API é suspenso. Não usar o logo do RemoteOK sem autorização por escrito (marca registrada), mas usar o nome "Remote OK" | Link **dofollow** para a vaga no RemoteOK e citação "Remote OK"; sem o logo deles (`companyLogoUrl` sempre nulo). Registro: rótulo "Remote OK", `dofollow: true` (a sanitização e o link da fonte na tela omitem o `nofollow` só para esta fonte) | Sim | 1 requisição por coleta (resposta de cerca de 1 MB); `url` aponta para a página da vaga no RemoteOK, nunca para o link de candidatura; `location` vira `eligibleRegions`; salário só quando a API informa (USD por ano); intervalo mínimo de 60 min |

Os hosts de Ashby, Lever e GitHub estão em `ASHBY_HOST`, `LEVER_HOST`, `GITHUB_HOST`, `WWR_HOST` e `REMOTEOK_HOST` nos respectivos conectores (`allowedHosts`); os demais são `himalayas.app`, `boards-api.greenhouse.io` e `jobicy.com`.

### Boards curados

Nada além destas listas é consultado. Mudar a lista exige editar o conector.

- **Greenhouse:** stone, c6bank, btgpactual, xpinc, inter, quintoandar, gympass, clara, ebanx, vtex, jusbrasil, wildlifestudios, getnet, gitlab, canonical, twilio, datadog, stripe, databricks.
- **Ashby:** nubank, supabase, openai, posthog, linear, sanity, replit, vanta, plaid, ramp, notion, cohere.
- **Lever:** ciandt, neon, swile, toptal, spotify.
- **GitHub (`GITHUB_REPOS`):** frontendbr/vagas, backend-br/vagas, react-brasil/vagas, qa-brasil/vagas, androiddevbr/vagas.

## Fontes planejadas

Planejadas para a Fase 4: Hacker News "Who is hiring" e SmartRecruiters. Fora da lista por termos de uso: Gupy, Coodesh e Remotive.

## Operação

Passos manuais para quem mantém o projeto (não automatizados):

0. **Confirmar os termos (RN-09):** uma fonte só fica em dia quando link e data de checagem dos termos estão preenchidos na tabela acima.
   - Confirmar os termos de Greenhouse, Ashby e Lever e preencher o link e a data. As páginas de API checadas não trazem termos nem atribuição.
   - Confirmar os termos de Himalayas (`https://himalayas.app/terms#api`) e de Jobicy (`https://jobicy.com/terms-and-conditions`) e registrar a data da leitura.

1. **Provisionar na Vercel:**
   - Criar o banco Neon pelo Marketplace da Vercel (região `gru1`/`sa-east-1`, máximo de 0,25 CU).
   - Configurar as quatro variáveis aprovadas: `DATABASE_URL`, `CRON_SECRET`, `GITHUB_TOKEN` e `HIMALAYAS_API_KEY`.
   - Criar a regra do WAF: caminho `/api/*`, 120 requisições a cada 60 s por IP, resposta 429.
2. **Deploy e primeira coleta:**
   - Fazer o deploy (em produção, o build roda `pnpm db:migrate`).
   - Disparar a coleta manualmente. A rota `/api/cron/collect` aceita GET e POST; o agendador da Vercel usa GET, então prefira:
     `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/collect`
   - Conferir a tabela `source_runs` (uma linha por fonte, sem erros).
3. **Portão da Fase 1:** 1.000 ou mais vagas ativas depois de 24 h; atraso p90 da coleta de até 2 h; `/api/jobs` com p95 de até 500 ms sem cache (medido com `autocannon`).
