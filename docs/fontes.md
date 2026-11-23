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
| Himalayas | `https://himalayas.app/jobs/api` (paginação por cursor, `limit=20`, `Authorization: Bearer $HIMALAYAS_API_KEY` quando definida) | A confirmar (a spec registra só que o termo proíbe repassar as vagas a agregadores e ao Google Jobs; link e data não foram registrados) | Link visível para o Himalayas; `applicationLink` intacto; não repassar a agregadores nem ao Google. Registro: rótulo "Himalayas", sem dofollow | Não (incremental por cursor/guid) | 60 req/min na API gratuita; máximo de 25 páginas (500 vagas) por coleta; intervalo mínimo de 60 min |
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true` | A confirmar (link e data não registrados na spec) | Link para a vaga. Registro: rótulo "Greenhouse", sem dofollow | Sim | 19 boards curados (abaixo); até 3 requisições simultâneas; board fora do ar é ignorado, e só falha se todos falharem |
| Ashby | `https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true` | A confirmar (link e data não registrados na spec) | Link para a vaga. Registro: rótulo "Ashby", sem dofollow | Sim | 12 boards curados (abaixo); até 3 requisições simultâneas |
| Lever | `https://api.lever.co/v0/postings/<slug>?mode=json` | A confirmar (link e data não registrados na spec) | Link para a vaga. Registro: rótulo "Lever", sem dofollow | Sim | 5 boards curados (abaixo); até 3 requisições simultâneas |
| Jobicy | `https://jobicy.com/api/v2/remote-jobs?count=50&industry=engineering&geo=brazil` e `geo=latam` | A confirmar (link e data não registrados na spec) | Crédito com link para o Jobicy; candidatura pelo link do Jobicy. Registro: rótulo "Jobicy", sem dofollow | Não (incremental, janela de 7 dias) | 50 vagas por consulta (2 consultas, ids duplicados descartados); no máximo 1 coleta por hora (`minIntervalMinutes: 60`) |

Os hosts de Ashby e Lever estão em `ASHBY_HOST` e `LEVER_HOST` nos respectivos conectores (`allowedHosts`); os demais são `himalayas.app`, `boards-api.greenhouse.io` e `jobicy.com`.

### Boards curados

Nada além destas listas é consultado. Mudar a lista exige editar o conector.

- **Greenhouse:** stone, c6bank, btgpactual, xpinc, inter, quintoandar, gympass, clara, ebanx, vtex, jusbrasil, wildlifestudios, getnet, gitlab, canonical, twilio, datadog, stripe, databricks.
- **Ashby:** nubank, supabase, openai, posthog, linear, sanity, replit, vanta, plaid, ramp, notion, cohere.
- **Lever:** ciandt, neon, swile, toptal, spotify.

## Fontes planejadas

Planejadas para a Fase 4: GitHub issues, We Work Remotely (RSS), RemoteOK, Hacker News "Who is hiring" e SmartRecruiters. Fora da lista por termos de uso: Gupy, Coodesh e Remotive.

## Operação

Passos manuais para quem mantém o projeto (não automatizados):

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
