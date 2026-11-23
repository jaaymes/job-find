# PRD: Job Find — agregador de vagas de tecnologia com currículo adaptado por IA

| Campo | Valor |
|---|---|
| Status | Rascunho |
| Autor / PO | Jaymes (com apoio de IA) |
| Data | 2026-11-23 |
| Stakeholders | Jaymes (dono do produto e desenvolvedor) |
| Versão | 0.3 |

## 1. Resumo

O Job Find é uma plataforma web pública, sem login, que reúne vagas de tecnologia nacionais e internacionais de várias fontes abertas em um só lugar. As vagas aparecem sempre da mais nova para a mais antiga e podem ser filtradas por stack (React, Angular, Vue…), por modelo de trabalho (remoto, híbrido, presencial) e por origem (nacional ou internacional). Cada vaga mostra uma estimativa de "chance de ser chamado". A partir do currículo da pessoa, a IA que ela escolher (OpenRouter, OpenAI, Anthropic, Google Gemini, DeepSeek, IA local e outros, sempre com a própria chave) gera um currículo e uma carta de apresentação adaptados à vaga, em PDF. Todos os dados pessoais ficam no navegador (localStorage).

O Job Find é um projeto **open-source** (repositório público em https://github.com/jaaymes/job-find), feito para ajudar quem está procurando emprego e concentrar tudo num só lugar. Qualquer pessoa pode usar a versão hospedada, contribuir com novas fontes ou rodar a própria instância.

## 2. Contexto e problema

- **Situação atual:** quem procura vaga de tecnologia precisa visitar dezenas de sites (boards remotos internacionais, Gupy, repositórios de vagas no GitHub, páginas de carreira), repetir os mesmos filtros em cada um e não sabe quais vagas já viu.
- **Segunda dor:** mandar o mesmo currículo para todas as vagas diminui a chance de passar por triagem (ATS e recrutador). Adaptar o currículo à mão para cada vaga leva de 20 a 40 minutos.
- **Terceira dor:** é difícil priorizar. Sem saber onde há mais aderência, a pessoa gasta tempo em vagas com pouca chance de retorno.
- **Por que agora:** existem APIs e feeds abertos suficientes para cobrir boa parte do mercado, e LLMs baratos (DeepSeek via OpenRouter) tornam viável gerar um currículo por vaga a um custo de centavos.

## 3. Objetivos e métricas de sucesso

| Objetivo | Métrica | Baseline | Meta | Prazo |
|---|---|---|---|---|
| Cobrir o mercado de vagas tech | Vagas ativas únicas no índice | 0 | ≥ 3.000 vagas ativas (≥ 800 nacionais), de ≥ 10 fontes | 4 semanas após o lançamento |
| Vagas frescas | Atraso entre a publicação na fonte e a vaga aparecer na plataforma (p90) | — | ≤ 2 h | No lançamento |
| Facilitar a candidatura | % de sessões com perfil que geram ao menos 1 CV adaptado | — | ≥ 30% | 8 semanas |
| Priorização útil | % de vagas marcadas como "aplicada" com chance Alta ou Média | — | ≥ 60% | 8 semanas |
| Qualidade do índice | % de vagas duplicadas visíveis (amostra manual de 100) | — | ≤ 3% | 4 semanas |

**Não-objetivos:**
- Não somos um ATS nem um canal de candidatura: o botão "Candidatar" leva para a página original da vaga.
- Não vamos garantir nem prometer contratação. A "chance" é uma estimativa de aderência, não uma probabilidade real.
- Não vamos coletar dados de sites cujos Termos de Uso proíbem coleta automatizada (LinkedIn, Indeed, Glassdoor).
- Não haverá conta, sincronização entre dispositivos nem backup em nuvem dos dados pessoais.
- Não vamos vender nem revender acesso a IA: cada pessoa usa a própria chave (BYOK) e paga diretamente ao provedor que escolher.

## 4. Usuários e personas

- **Dev em busca de vaga (principal):** de júnior a sênior, procura vaga no Brasil ou remota no exterior e acessa pelo desktop durante a busca ativa, várias vezes por semana. Tem familiaridade técnica alta e consegue criar a própria chave OpenRouter.
- **Dev passivo:** está empregado e olha vagas de vez em quando, filtrando pela própria stack. Pode usar a plataforma sem chave de IA, só para buscar.
- **Mantenedor (Jaymes):** cuida das fontes, acompanha a saúde da coleta e o custo de infraestrutura. Não tem painel administrativo no MVP.
- **Contribuidor open-source:** dev que adiciona um conector de fonte ou um provedor de IA via pull request, seguindo o guia de contribuição.

Não há perfis nem permissões: tudo é público e anônimo, e cada navegador funciona como um "usuário".

## 5. Escopo

**MVP (Must)**
- Coleta automática a cada 1 hora (Vercel Schedules), a partir de fontes abertas, para um Postgres compartilhado.
- Normalização, deduplicação, extração de stacks (tags) e classificação nacional/internacional e remoto/híbrido/presencial.
- Listagem em ordem cronológica decrescente, com paginação, busca por texto e filtros.
- Separação da listagem por modelo de trabalho (abas ou filtro rápido) e por faixa de chance (Alta/Média/Baixa).
- Página de Configurações com vários provedores de IA (BYOK): conectar OpenRouter por login (PKCE) ou colar a chave de OpenAI, Anthropic, Google Gemini, DeepSeek e outros; IA local (Ollama/LM Studio) como experimental; escolher provedor e modelo por tarefa; testar conexão e remover chave.
- Repositório open-source com README, licença MIT, guia de contribuição (como adicionar uma fonte ou um provedor) e guia para rodar a própria instância.
- Importação do currículo (PDF, DOCX ou texto colado) → perfil estruturado pela IA → edição manual do perfil.
- Score local de "chance" calculado para todas as vagas a partir do perfil.
- Análise detalhada por IA de uma vaga sob demanda (pontos fortes, lacunas, palavras-chave).
- Geração de CV adaptado + carta de apresentação no idioma da vaga, com pré-visualização, edição e download em PDF.
- Favoritar, ocultar/descartar e status de candidatura (Salva → Aplicada → Entrevista → Oferta / Recusada).
- Exportar e importar todos os dados locais em um arquivo JSON (proteção contra perda de dados do navegador).

**Should**
- Filtros salvos ("minha busca padrão") em localStorage.
- Selo "Nova" para vagas publicadas desde a última visita.
- Mais de um modelo de CV em PDF (ex.: clássico e moderno, ambos compatíveis com ATS).
- Faixa salarial normalizada quando a fonte informar.

**Could**
- Alertas por e-mail ou push (exigiria identificar o usuário, o que conflita com "sem login").
- PWA instalável.
- Histórico de versões do CV gerado por vaga.

**Fora de escopo (Won't, nesta versão)**
- Login, contas e sincronização entre dispositivos.
- Coleta de LinkedIn, Indeed, Glassdoor ou qualquer fonte que proíba coleta automatizada.
- Candidatura automática nas vagas.
- Painel administrativo de fontes (a configuração fica no código).
- Aplicativo mobile nativo. A web precisa funcionar bem no celular, mas a geração de CV é pensada para o desktop.

## 6. Jornadas e user stories

**US-01 — Ver as vagas mais recentes**
Como dev, quero ver as vagas de tecnologia mais recentes de várias fontes em uma lista só, para não ter que visitar vários sites.
- Dado que existem vagas no índice, quando abro a página inicial, então vejo as vagas da mais nova para a mais antiga (pela data de publicação na fonte), cada uma com título, empresa, local, modelo de trabalho, stacks, fonte, idade ("há 3 h") e link para a vaga original.
- Dado que duas fontes publicaram a mesma vaga, quando ela aparece na lista, então aparece uma vez só, indicando as fontes.
- Dado que a coleta falhou na última hora, quando abro a página, então ainda vejo as vagas da última coleta bem-sucedida, com o horário dessa coleta.
- Dado que nenhuma vaga atende aos filtros, quando a lista carrega, então vejo um estado vazio com a opção "Limpar filtros".

**US-02 — Filtrar por origem, modelo e stack**
Como dev, quero filtrar por vagas nacionais ou internacionais, por remoto/híbrido/presencial e por tecnologia, para ver só o que me interessa.
- Dado que seleciono "Nacional", quando aplico o filtro, então vejo só vagas de empresas ou locais no Brasil.
- Dado que seleciono "Internacional" + "Aceita Brasil", quando aplico, então vejo vagas no exterior abertas a candidatos residentes no Brasil (worldwide, LATAM, Americas ou Brasil explícito).
- Dado que seleciono as stacks React e Vue, quando aplico, então vejo vagas com React **ou** Vue. Existe uma opção para exigir todas as stacks selecionadas.
- Dado que mudo um filtro, quando a lista recarrega, então a ordem continua da mais nova para a mais antiga e os filtros ficam na URL (a URL pode ser compartilhada).

**US-03 — Configurar a IA**
Como dev, quero conectar a IA que eu já uso (OpenRouter, OpenAI, Anthropic, Gemini, DeepSeek, uma IA local ou outro provedor) e escolher o modelo de cada tarefa, para usar os recursos de IA com a minha conta e o meu orçamento.
- Dado que escolho OpenRouter, quando clico em "Conectar", então faço login no OpenRouter e volto com uma chave criada só para o Job Find, com limite de gasto.
- Dado que escolho outro provedor, quando colo a chave, então ela é validada e o provedor aparece como "Conectado".
- Dado que tenho mais de um provedor conectado, quando abro "Modelo para cada tarefa", então escolho provedor e modelo separadamente para ler currículo, analisar vaga e gerar CV/carta.
- Dado que escolho um provedor com aviso de privacidade (ex.: plano gratuito do Gemini, DeepSeek direto), quando uso a IA pela primeira vez com ele, então vejo o aviso e preciso confirmar.
- Dado que abro Configurações, quando colo a chave e clico em "Testar conexão", então vejo sucesso (com o modelo respondendo) ou o erro claro (chave inválida, sem crédito, modelo indisponível).
- Dado que não escolhi um modelo, quando uso a IA, então o modelo padrão da família DeepSeek é usado.
- Dado que não tenho chave, quando tento importar currículo ou gerar CV, então sou levado às Configurações com uma explicação de como criar a chave. A busca de vagas continua funcionando sem chave.
- Dado que clico em "Remover chave", então a chave é apagada do localStorage.

**US-04 — Importar o currículo base**
Como dev, quero enviar meu currículo (PDF, DOCX ou texto) para que a plataforma conheça meu perfil.
- Dado que envio um PDF com texto selecionável de até 5 MB, quando a importação termina, então vejo o perfil estruturado (dados de contato, resumo, experiências, formação, skills, idiomas, senioridade estimada, localização, links) pronto para revisar.
- Dado que envio um PDF escaneado (sem texto extraível), quando a extração retorna vazia, então vejo a mensagem "Não consegui ler o texto deste PDF; cole o texto do currículo" com o campo de texto aberto.
- Dado que edito qualquer campo do perfil e salvo, então essa edição é a fonte de verdade para o score e para as próximas gerações.
- Dado que importo um novo currículo com um perfil já salvo, então preciso confirmar a substituição.

**US-05 — Ver a chance de ser chamado**
Como dev com perfil salvo, quero ver em cada vaga uma estimativa de aderência, para priorizar onde aplicar.
- Dado que tenho perfil, quando a lista carrega, então cada vaga mostra a faixa Alta/Média/Baixa e o percentual, calculados no navegador e sem custo de IA.
- Dado que não tenho perfil, quando a lista carrega, então a coluna de chance mostra "Importe seu currículo para ver".
- Dado que abro uma vaga e clico em "Analisar com IA", então recebo em até 30 s os pontos fortes, as lacunas, as palavras-chave que faltam no currículo e uma nota revisada. O resultado fica salvo para aquela vaga.
- Dado que filtro por "Chance: Alta", então vejo só vagas com score ≥ 70, ainda da mais nova para a mais antiga.

**US-06 — Gerar CV e carta adaptados**
Como dev, quero gerar um CV e uma carta adaptados à vaga, para me destacar na triagem.
- Dado que tenho perfil e chave, quando clico em "Gerar CV para esta vaga", então em até 60 s vejo a pré-visualização do CV no idioma da vaga, reordenando e reescrevendo experiências e skills para destacar o que é relevante.
- Dado que o CV foi gerado, então ele contém **apenas** fatos presentes no perfil: nenhuma empresa, cargo, data, certificação ou tecnologia inventada.
- Dado que estou na pré-visualização, quando edito um trecho e clico em "Baixar PDF", então baixo um PDF de texto selecionável (compatível com ATS) com o nome `CV-<Nome>-<Empresa>-<cargo>.pdf`.
- Dado que marco "Incluir carta de apresentação", então a carta também é gerada, editável e baixável em PDF.
- Dado que quero outro idioma, quando troco o seletor (PT/EN/ES), então a geração é refeita nesse idioma.
- Dado que a chamada falha (timeout, sem crédito, limite de requisições), então vejo o erro, posso tentar de novo e nada do que eu já tinha editado se perde.

**US-07 — Organizar candidaturas**
Como dev, quero favoritar, ocultar e acompanhar o status das vagas, para não me perder.
- Dado que favorito uma vaga, então ela aparece na aba "Minhas vagas" mesmo depois de sair do índice público. Os dados da vaga ficam salvos no localStorage.
- Dado que oculto uma vaga, então ela some da listagem principal, e existe um filtro "Mostrar ocultas" para desfazer.
- Dado que mudo o status para "Aplicada", então a data é registrada e a vaga mostra o selo de status na listagem.

**US-08 — Backup local**
Como dev, quero exportar e importar meus dados, para não perdê-los se o navegador limpar o armazenamento.
- Dado que clico em "Exportar dados", então baixo um JSON com o perfil, as configurações (sem a chave, a menos que eu marque essa opção), os favoritos, os status e os CVs gerados.
- Dado que importo esse JSON em outro navegador, então recupero tudo.

## 7. Requisitos funcionais

| ID | Requisito | Prioridade | Critério de aceite |
|---|---|---|---|
| RF-01 | Coletar vagas de cada fonte habilitada a cada 1 h, disparado pelo Vercel Schedules | Must | Log de execução por fonte com início, fim, vagas novas e atualizadas, e erros; atraso p90 ≤ 2 h |
| RF-02 | Normalizar a vaga para o modelo único (seção 10) | Must | 100% das vagas salvas têm título, URL, fonte e data de publicação (ou data da primeira coleta, como fallback) |
| RF-03 | Deduplicar entre fontes | Must | Mesma vaga em 2 fontes = 1 registro com lista de fontes; ≤ 3% de duplicadas visíveis |
| RF-04 | Extrair stacks por dicionário de sinônimos (ex.: "ReactJS", "React.js" → `react`) a partir de título, tags e descrição | Must | Dicionário inicial com ≥ 60 tecnologias; precisão ≥ 90% em amostra de 100 vagas |
| RF-05 | Classificar a origem (nacional / internacional) e a elegibilidade Brasil (`aceita_brasil`) | Must | Regras em RN-03; vagas sem informação suficiente ficam como "Não informado" |
| RF-06 | Classificar o modelo de trabalho (remoto / híbrido / presencial / não informado) | Must | Ver RN-04 |
| RF-07 | Expirar vagas | Must | Vagas com mais de 45 dias, ou ausentes da fonte por 3 coletas seguidas, saem da listagem |
| RF-08 | API de listagem paginada, ordenada por `publicado_em DESC` | Must | p95 ≤ 500 ms com 20 mil vagas; 30 itens por página; rolagem infinita ou paginação |
| RF-09 | Filtros: texto, stacks (OU/E), origem, aceita Brasil, modelo de trabalho, senioridade, idioma da vaga, período (24 h / 7 d / 30 d), fonte | Must | Combináveis; refletidos na URL |
| RF-10 | Separação por modelo de trabalho (abas Todas / Remoto / Híbrido / Presencial) e filtro por faixa de chance | Must | Contadores por aba; a ordem cronológica se mantém dentro de cada aba |
| RF-11 | Configurações multi-provedor (BYOK): OpenRouter (PKCE), OpenAI, Anthropic, Google Gemini, DeepSeek e IA local no Must; Groq, Mistral, Cerebras, xAI, Together, Fireworks, Hugging Face e Vercel AI Gateway no Should; lista de modelos de cada provedor; provedor e modelo por tarefa; testar e remover chave; aviso de privacidade por provedor | Must | Ver US-03 |
| RF-24 | Repositório open-source: README, licença MIT, CONTRIBUTING com guia de "nova fonte" e "novo provedor de IA", guia de self-host | Must | Repositório público com os arquivos e CI verde |
| RF-12 | Importar currículo de PDF, DOCX ou texto, extraindo o texto **no navegador** | Must | Ver US-04; o arquivo nunca é enviado ao servidor do Job Find |
| RF-13 | Estruturar o perfil via IA em JSON com schema fixo, validado antes de salvar | Must | JSON inválido → nova tentativa automática (1x) → erro amigável |
| RF-14 | Editor de perfil | Must | Todos os campos do schema são editáveis; adicionar/remover experiências e skills |
| RF-15 | Score local de chance (RN-06) | Must | Calculado em ≤ 200 ms para 30 vagas visíveis; recalculado quando o perfil muda |
| RF-16 | Análise detalhada por IA sob demanda | Must | Ver US-05; resultado guardado por vaga no localStorage |
| RF-17 | Gerar CV adaptado (RN-07) + carta opcional no idioma da vaga | Must | Ver US-06 |
| RF-18 | Pré-visualizar, editar e baixar o PDF gerado no navegador | Must | PDF com texto selecionável, 1 a 2 páginas, fontes embutidas, sem tabelas/colunas que quebrem o ATS |
| RF-19 | Favoritar, ocultar e definir status de candidatura | Must | Ver US-07 |
| RF-20 | Exportar e importar dados locais em JSON | Must | Ver US-08; o import valida versão e schema |
| RF-21 | Mostrar o horário da última coleta e o estado por fonte (ok / falhando) | Should | Rodapé ou página "Fontes" |
| RF-22 | Filtros salvos e selo "Nova" desde a última visita | Should | localStorage |
| RF-23 | Normalizar a faixa salarial (moeda, período) quando existir | Should | Exibida apenas se a fonte informar |

## 8. Regras de negócio

| ID | Regra | Exceções |
|---|---|---|
| RN-01 | Só entram vagas de tecnologia: título ou tags batendo com o dicionário de cargos tech (dev, engenheiro de software, QA, dados, DevOps/SRE, mobile, segurança, produto técnico, UX) | Fontes 100% tech (ex.: repositórios de vagas de dev) entram sem esse filtro |
| RN-02 | Ordenação padrão e obrigatória: `publicado_em DESC`. Empate → `coletado_em DESC` | Nenhuma: a chance e as abas filtram, mas não reordenam |
| RN-03 | **Nacional** = país da vaga é o Brasil, ou a fonte é brasileira e não indica outro país. **Internacional** = qualquer outro país, ou remoto global. `aceita_brasil` = verdadeiro se a vaga é nacional ou se a região de elegibilidade inclui Worldwide/LATAM/Americas/Brazil | Se a vaga for ambígua, a origem fica "Não informado" e a vaga aparece só sem filtro de origem |
| RN-04 | Modelo de trabalho vem do campo estruturado da fonte; sem campo, usa palavras-chave ("remoto", "remote", "home office", "híbrido", "hybrid", "presencial", "on-site") | Conflito entre campo e texto → vale o campo |
| RN-05 | Deduplicação: chave = normalização(empresa) + normalização(título) + país + modelo de trabalho, dentro de uma janela de 30 dias; se a URL canônica for igual, é a mesma vaga | Mesma empresa e título em cidades diferentes contam como vagas distintas |
| RN-06 | Score local (0–100) = 45% aderência de stack (skills do perfil ∩ stacks da vaga, ponderado pelas stacks da vaga) + 20% senioridade (exata = 100, ±1 nível = 50, ±2 ou mais = 0) + 15% idioma (pede inglês e o perfil não tem inglês ≥ intermediário → 0) + 15% elegibilidade de local (`aceita_brasil` ou mesma cidade para presencial/híbrido) + 5% recência (≤ 3 dias = 100, decaindo até 0 em 30 dias). Faixas: Alta ≥ 70, Média 40–69, Baixa < 40 | Dados faltando na vaga → o peso daquele critério é redistribuído entre os demais. Os pesos são premissa (P-04) e devem ser calibrados |
| RN-07 | O CV gerado só pode reordenar, resumir e reescrever o que está no perfil. Proibido inventar experiência, empresa, data, cargo, formação, certificação ou nível de skill | A IA pode sugerir "lacunas" em uma seção separada, que não vai para o PDF |
| RN-08 | Idioma do CV e da carta = idioma detectado na descrição da vaga (pt, en, es); padrão pt-BR | O usuário pode trocar manualmente |
| RN-09 | Só podem ser habilitadas fontes com API, RSS ou feed público cujos Termos de Uso não proíbam o uso automatizado; respeitar o rate limit e o `robots.txt` de cada uma | Uma fonte só entra após a verificação de ToS registrada em `docs/fontes.md` |
| RN-10 | Toda vaga exibida mostra a fonte e linka a URL original; a descrição exibida pode ser resumida/truncada | — |
| RN-11 | As chaves de IA de todos os provedores e todos os dados pessoais (currículo, perfil, CVs, favoritos, status) ficam só no localStorage do navegador e nunca são enviados ao servidor do Job Find | — |

**Estados da candidatura (por vaga, no localStorage):**
`nenhum → salva → aplicada → entrevista → oferta | recusada`. Qualquer estado pode voltar para `nenhum`. `oculta` é um flag independente do status.

## 9. Requisitos não funcionais

| ID | Requisito | Meta |
|---|---|---|
| RNF-01 | Desempenho da listagem | API p95 ≤ 500 ms; LCP da página inicial ≤ 2,5 s em 4G |
| RNF-02 | Tempo de IA | Estruturar o perfil ≤ 45 s; análise ≤ 30 s; CV + carta ≤ 60 s (com streaming, para mostrar progresso) |
| RNF-03 | Coleta dentro do limite da Vercel | Cada invocação processa um lote de fontes dentro do limite de duração da função; nenhuma fonte bloqueia as outras (timeout de 20 s por fonte) |
| RNF-04 | Resiliência das fontes | Falha de uma fonte não afeta as demais nem apaga as vagas dela; 3 falhas seguidas marcam a fonte como "falhando" |
| RNF-05 | Privacidade / LGPD | Nenhum dado pessoal chega ao servidor; sem cookies de rastreamento; analytics só agregado e sem PII; página "Privacidade" explicando que o currículo vai para o provedor de IA escolhido do modelo escolhido |
| RNF-06 | Segurança da chave | CSP restritiva (`connect-src` só para o próprio domínio e `openrouter.ai`), sem scripts de terceiros, sanitização de todo HTML vindo das fontes (prevenção de XSS, que exporia a chave) |
| RNF-07 | Endpoint de coleta protegido | A rota de coleta só executa com o segredo correto no header; requisição sem segredo → 401 |
| RNF-08 | Acessibilidade | WCAG 2.1 AA nas telas principais; navegação por teclado na lista e nos filtros |
| RNF-09 | Responsivo | Listagem e filtros usáveis a partir de 360 px de largura |
| RNF-10 | Limite do localStorage | Uso monitorado; aviso ao passar de 4 MB, sugerindo exportar e limpar CVs antigos (PDFs não são guardados, só o conteúdo estruturado) |
| RNF-11 | Custo | Infra no free tier (Vercel Hobby + Postgres free) até ~20 mil vagas ativas; custo de IA pago pelo próprio usuário |

## 10. Visão técnica

**Stack:** Next.js (App Router) + TypeScript na Vercel; Postgres gerenciado (Neon via Vercel Marketplace) só para o índice público de vagas; ORM leve (Drizzle ou Prisma, a decidir pelo time); UI com Tailwind + shadcn/ui (sugestão).

**Componentes**
- `app/(public)/` — listagem, detalhe da vaga, Minhas vagas, Perfil, Configurações, Privacidade, Fontes.
- `app/api/jobs` — `GET` de listagem com filtros e paginação por cursor (`publicado_em`, `id`).
- `app/api/jobs/[id]` — `GET` de detalhe (descrição completa sanitizada).
- `app/api/cron/collect` — protegido por segredo; recebe `?sources=a,b` opcional. Um disparo por hora do Vercel Schedules processa todas as fontes em paralelo (ver spec técnica D-02).
- `lib/sources/<fonte>.ts` — um conector por fonte, com interface comum `fetchJobs(): Promise<RawJob[]>` + `normalize(raw): Job`.
- `lib/enrich/` — dicionário de stacks, detecção de idioma, classificação de origem, modelo de trabalho e senioridade.
- `lib/ai/` (client-side) — registro de provedores de IA chamados **direto do navegador** com a chave do usuário (todos os provedores em nuvem testados aceitam CORS), com prompts versionados e saída em JSON validada com Zod. Ver spec técnica D-17.
- `lib/score/` (client-side) — score local (RN-06).
- `lib/storage/` (client-side) — camada sobre o localStorage com versão de schema e migrações.
- `lib/pdf/` (client-side) — geração do PDF no navegador (ex.: `@react-pdf/renderer`); extração de PDF com `pdfjs-dist` e de DOCX com `mammoth`.

**Fontes candidatas iniciais** (todas dependem da verificação de ToS da RN-09 antes de habilitar)
- Internacionais/remotas: Remotive (API), RemoteOK (API), Arbeitnow (API), Himalayas (API), Jobicy (API), We Work Remotely (RSS), Working Nomads (API), Hacker News "Who is hiring" (API Algolia), boards públicos Greenhouse / Lever / Ashby de uma lista curada de empresas que contratam remoto/LATAM.
- Nacionais: repositórios de vagas no GitHub via API de issues (ex.: frontendbr/vagas, backend-br/vagas, react-brasil/vagas e similares), boards Greenhouse/Lever/Ashby de empresas brasileiras. Gupy e Coodesh foram excluídas porque os termos proíbem agregação (só com parceria formal).
- Meta do MVP: ≥ 10 fontes ativas.

**Dados (Postgres)**
- `jobs`: `id`, `dedupe_key` (único), `title`, `company`, `company_logo_url?`, `description_html` (sanitizado), `description_text`, `url_canonical`, `country?`, `city?`, `origin` (`national` | `international` | `unknown`), `accepts_brazil` (bool?), `work_mode` (`remote` | `hybrid` | `onsite` | `unknown`), `seniority?` (`intern` | `junior` | `mid` | `senior` | `lead`), `language` (`pt` | `en` | `es` | …), `stacks` (`text[]`, com índice GIN), `salary_min?`, `salary_max?`, `salary_currency?`, `salary_period?`, `published_at`, `first_seen_at`, `last_seen_at`, `expired_at?`, `search_vector` (tsvector, índice GIN).
- `job_sources`: `job_id`, `source`, `external_id`, `url`, `last_seen_at` (índice único em `source + external_id`).
- `source_runs`: `source`, `started_at`, `finished_at`, `status`, `new_count`, `updated_count`, `error?`.
- Índices: `(published_at DESC, id DESC)`, GIN em `stacks` e `search_vector`, B-tree em `origin`, `work_mode` e `expired_at`.
- Retenção: um job diário apaga as vagas expiradas há mais de 30 dias.

**Dados (localStorage, versionado em `jobfind:v1:*`)**
- `settings`: `{ openrouterKey, model, uiLanguage }`
- `profile`: `{ name, contact, headline, summary, location, seniority, languages[], skills[{name, level, years}], experiences[{company, role, start, end, bullets[], stacks[]}], education[], certifications[], links[] }`
- `jobState[jobId]`: `{ favorite, hidden, status, statusHistory[], snapshot (dados mínimos da vaga para sobreviver à expiração) }`
- `aiAnalysis[jobId]`, `generatedDocs[jobId]`: `{ lang, cv (JSON estruturado), coverLetter?, createdAt, model, promptVersion }`

**APIs (contratos de alto nível)**
- `GET /api/jobs?q=&stacks=react,vue&stacksMode=any|all&origin=&acceptsBrazil=&workMode=&seniority=&lang=&since=24h|7d|30d&source=&cursor=` → `{ items: JobSummary[], nextCursor, counts: { remote, hybrid, onsite, all } }`
- `GET /api/jobs/:id` → `Job`
- `POST /api/cron/collect?sources=` (header com o segredo) → `{ runs: SourceRun[] }`. É idempotente: o upsert é feito por `source + external_id`.
- O filtro de chance é aplicado **no cliente** sobre a página carregada (o servidor não conhece o perfil). Para não esvaziar páginas, o cliente busca mais páginas até preencher 30 itens ou atingir 5 requisições.

**Segurança**
- A chave OpenRouter não passa pelo servidor (chamada direta do navegador). Riscos de XSS são mitigados com CSP, sanitização (DOMPurify/`sanitize-html` na ingestão) e nenhum script de terceiros.
- Rate limit simples na API pública de listagem (ex.: 60 req/min por IP) para evitar abuso de custo do banco.
- Prompt injection: a descrição da vaga entra no prompt como dado delimitado; a saída é validada por schema; o resultado só é exibido e editado, nunca executado.

**Integrações e falhas**
- OpenRouter: tratar 401 (chave), 402 (sem crédito), 429 (limite), 5xx/timeout, mostrando a mensagem e oferecendo nova tentativa. Lista de modelos via `GET /api/v1/models`, filtrando e destacando `deepseek/*`.
- Fontes: timeout de 20 s, retry com backoff (1x); mudança de formato → a validação do Zod falha → o run fica "erro" e as vagas antigas daquela fonte são mantidas.

**Variáveis de ambiente necessárias** (pendem de aprovação do Jaymes, ver Q-01): string de conexão do Postgres e segredo do endpoint de coleta. Nenhuma feature flag: tudo entra ativo.

**Rollout e rollback:** deploy direto na Vercel; rollback pelo "Instant Rollback" da Vercel. Mudanças de schema do banco via migrations versionadas. Mudanças no schema do localStorage via migração em `lib/storage` (`v1 → v2`), sem perder dados.

**Observabilidade:** a tabela `source_runs` + uma página "Fontes" pública com status; logs da Vercel; alerta quando uma fonte falha 3x seguidas ou a coleta inteira passa 3 h sem rodar (o workflow do GitHub Actions falha visivelmente; e-mail de falha do próprio GitHub).

**Estratégia de testes**
- Unitários: normalizadores por fonte com fixtures reais salvas, dicionário de stacks, classificação de origem/modo, score (RN-06), deduplicação (RN-05), migrações do localStorage.
- Contrato: um teste por fonte que valida o payload real (rodando em CI agendado, não no build).
- Integração: `GET /api/jobs` com filtros contra um Postgres de teste.
- E2E (Playwright): importar currículo de fixture → gerar CV com o OpenRouter mockado → baixar o PDF; filtros + ordenação.
- IA: conjunto de 10 pares currículo/vaga para checar RN-07 (nenhum fato inventado), revisado manualmente a cada mudança de prompt.

**Alternativas consideradas**
- *Tudo em localStorage, sem banco:* descartado, porque o índice de vagas é igual para todos e coletar a cada visita esbarraria no rate limit das fontes e deixaria a página lenta.
- *Redis/KV com snapshot JSON:* descartado, porque filtrar e paginar dezenas de milhares de vagas em memória a cada requisição escala mal.
- *Chave OpenRouter via proxy no servidor:* descartado, porque faria a chave trafegar e ficar em logs do servidor. A chamada direta do navegador é suportada pelo OpenRouter.
- *IA para calcular a chance de todas as vagas:* descartado, porque o custo cresce com cada vaga coletada. O modelo híbrido (local + IA sob demanda) foi o escolhido.
- *Vercel Cron no plano Hobby:* insuficiente (1x/dia). Escolhido cron externo gratuito de hora em hora.
- *Gerar o PDF no servidor (Puppeteer):* descartado, porque os dados pessoais iriam ao servidor e o pacote fica pesado na Vercel.

## 11. UX / UI

- **Home / Vagas:** barra de busca; chips de stacks populares (React, Angular, Vue, Node, Java, Python, Go, .NET, Flutter…) e seletor com todas as stacks; abas Todas / Remoto / Híbrido / Presencial com contadores; filtros laterais (origem, aceita Brasil, senioridade, idioma, período, fonte, chance). O card da vaga mostra título, empresa, local + bandeira, modelo, stacks (as que batem com o perfil destacadas), idade, fonte, selo de chance, e ações de favoritar, ocultar e status.
- **Detalhe da vaga:** descrição, botão "Candidatar na fonte", "Analisar com IA", "Gerar CV + carta".
- **Protótipo das telas (Claude Design):** https://claude.ai/artifact/RRMGiqTJomVt29Yq9EZL6Y — Vagas, Detalhe, Celular, Gerador, Perfil, Configurações de IA e Minhas vagas.
- **Gerador:** duas colunas (editor estruturado | pré-visualização do PDF), seletor de idioma, seletor de modelo de CV, "Regenerar", "Baixar PDF".
- **Perfil:** upload (arrastar e soltar), colar texto, editor de campos.
- **Minhas vagas:** lista por status (visão kanban simples ou abas).
- **Configurações:** cards de provedores (status, conectar/colar chave, testar, remover, aviso de privacidade), "Mais provedores", modelo por tarefa com custo estimado, privacidade, exportar/importar dados, apagar tudo.
- **Estados:** esqueleto ao carregar; lista vazia com "Limpar filtros"; sem perfil → banner "Importe seu currículo para ver suas chances"; sem chave → CTA para Configurações; coleta atrasada → aviso discreto com o horário da última atualização.
- **Idioma da interface:** pt-BR.

## 12. Dependências e restrições

- Conta Vercel (Hobby: funções de até 300 s, 4 h/mês de CPU ativa) e Neon Free (1 GB, 100 CU-h/mês; o limite de computação é o gargalo real).
- Vercel Schedules (beta) para o agendamento de hora em hora; GitHub Actions como plano B.
- Disponibilidade e Termos de Uso de cada fonte.
- O usuário precisa de conta (e, conforme o provedor, créditos) em algum provedor de IA suportado, ou de uma IA local rodando no computador.
- LGPD: o currículo é dado pessoal. O usuário o envia por conta própria ao provedor de IA que escolheu; a página de privacidade precisa deixar isso claro, inclusive que alguns provedores DeepSeek podem processar dados fora do Brasil.

## 13. Riscos e premissas

| Item | Tipo | Probabilidade / Impacto | Mitigação ou validação |
|---|---|---|---|
| R-01 Fonte muda formato ou sai do ar | Risco | Alta / Médio | Conector isolado, validação com Zod, testes de contrato agendados, status por fonte |
| R-02 Poucas vagas nacionais em fontes abertas | Risco | Média / Alto | Priorizar Gupy, repositórios GitHub e boards de empresas BR; medir vagas nacionais ativas na semana 1 |
| R-03 IA inventa fatos no CV | Risco | Média / Alto | RN-07 no prompt, saída estruturada, conjunto de teste, aviso "revise antes de enviar", edição obrigatória antes do download (pelo menos abrir a pré-visualização) |
| R-04 XSS rouba a chave do localStorage | Risco | Baixa / Alto | CSP, sanitização, nenhum script de terceiro |
| R-05 Limite do free tier (banco/funções) com uso público | Risco | Média / Médio | Rate limit, retenção de 45 dias, monitorar o uso mensal |
| R-06 Dados perdidos quando o navegador limpa o localStorage | Risco | Média / Médio | Exportar/importar JSON; lembrete periódico de backup |
| R-07 Score local enganoso desmotiva o usuário | Risco | Média / Médio | Mostrar "por que essa nota" (critérios), chamar de "aderência estimada" e calibrar os pesos |
| P-01 OpenRouter aceita chamadas diretas do navegador (CORS) com a chave do usuário | Premissa | — | **Confirmada** em 2026-11-23 (preflight com `access-control-allow-origin: *`) |
| P-02 O modelo padrão DeepSeek no OpenRouter gera JSON confiável e texto bom em PT/EN | Premissa | — | Spike com 5 currículos reais; o slug exato do modelo padrão é confirmado na lista de modelos na implementação |
| P-03 O Vercel Schedules (beta) dispara de hora em hora no Hobby enviando o segredo | Premissa | — | Validar no spike da Fase 0; plano B: GitHub Actions |
| P-04 Os pesos do score da RN-06 são um bom ponto de partida | Premissa | — | Calibrar com 30 vagas avaliadas manualmente |
| P-05 Usuários aceitam conectar a própria IA (BYOK) | Premissa | — | Medir a % de sessões com perfil que configuram a chave |

## 14. Plano de entrega

1. **Fase 0 — Spikes (2–3 dias):** chamada OpenRouter direto do browser; extração de PDF/DOCX no cliente; geração de PDF no cliente; validar ToS e payload das 10 primeiras fontes.
2. **Fase 1 — Índice de vagas:** schema do Postgres, 5 conectores, enriquecimento, rota de coleta + cron, listagem com filtros e ordenação. *Pronto quando* houver ≥ 1.000 vagas ativas e o atraso p90 for ≤ 2 h.
3. **Fase 2 — Perfil e chance:** Configurações, importação de currículo, editor de perfil, score local, análise por IA.
4. **Fase 3 — CV e carta:** geração, editor, PDF, idioma.
5. **Fase 4 — Organização e robustez:** favoritos, ocultar, status, exportar/importar, página Fontes, mais 5 conectores (total ≥ 10), página Privacidade.
6. **Lançamento:** deploy público; acompanhar as métricas da seção 3 semanalmente por 8 semanas.

## 15. Perguntas em aberto

| # | Pergunta | Responsável | Impacto se sem resposta | Status |
|---|---|---|---|---|
| Q-01 | Aprovar as variáveis de ambiente necessárias | Jaymes | Sem elas não há banco nem proteção da coleta | **Respondida** (2026-11-23): DATABASE_URL, CRON_SECRET, GITHUB_TOKEN e HIMALAYAS_API_KEY aprovadas |
| Q-02 | Qual analytics usar para medir as métricas sem login (Vercel Web Analytics com eventos agregados, ou nenhum)? | Jaymes | Sem analytics, as métricas da seção 3 ficam sem medição | Aberta |
| Q-03 | Lista final de fontes nacionais (quais repositórios GitHub e empresas BR em Greenhouse/Lever) | Jaymes / dev | Afeta o volume de vagas nacionais (R-02) | Aberta |
| Q-04 | Modelo visual do CV: um só (ATS clássico) no MVP ou dois? | Jaymes | Escopo da Fase 3 | Aberta (proposta: 1 no MVP) |
| Q-05 | Nome e domínio definitivos do produto | Jaymes | Página de privacidade, títulos | Aberta |
| Q-06 | A interface terá versão em inglês para o público internacional? | Jaymes | Esforço de i18n | Aberta (proposta: só pt-BR no MVP) |

## 16. Registro de decisões

| Data | Decisão | Motivo | Alternativas descartadas |
|---|---|---|---|
| 2026-11-23 | Plataforma pública, sem login | Público amplo de devs; o usuário não quer autenticação | Ferramenta pessoal |
| 2026-11-23 | Deploy na Vercel | Escolha do usuário | VPS/local |
| 2026-11-23 | Índice de vagas em Postgres gerenciado; dados pessoais só no localStorage | O índice é compartilhado e precisa de filtro e paginação; dados pessoais nunca saem do navegador | Redis/KV; coleta sob demanda |
| 2026-11-23 | Coleta de hora em hora via Vercel Schedules (revisada na spec técnica) | O Schedules roda até a cada 15 min no Hobby, sem serviço externo | Cron externo (plano B); cron diário; Vercel Pro |
| 2026-11-23 | Meta de vagas nacionais revisada para ≥ 800; Gupy e Coodesh fora | Termos de uso dessas fontes proíbem agregação | Esperar parcerias antes do lançamento |
| 2026-11-23 | Só fontes abertas e permitidas pelos ToS | Estabilidade e conformidade | Scraping de LinkedIn/Indeed |
| 2026-11-23 | Chance híbrida: score local + análise por IA sob demanda | Custo zero na listagem, profundidade quando o usuário pede | Só heurística; IA para toda vaga |
| 2026-11-23 | Currículo via PDF, DOCX, texto + editor | Cobrir todos os formatos e permitir correção | — |
| 2026-11-23 | CV e carta no idioma da vaga, com troca manual | Vagas internacionais esperam inglês | Sempre PT; perguntar sempre |
| 2026-11-23 | IA chamada direto do navegador; PDF gerado no navegador | A chave e o currículo não passam pelo servidor | Proxy no servidor; Puppeteer |
| 2026-11-23 | MVP inclui favoritos, ocultar, status e carta de apresentação | Pedido do usuário | — |
| 2026-11-23 | Projeto open-source (MIT) em repositório público | Ajudar quem procura emprego e aceitar contribuições | Código fechado |
| 2026-11-23 | IA multi-provedor (BYOK), chamada direto do navegador | Cada pessoa usa a IA que já tem; todos os provedores testados aceitam CORS | Só OpenRouter; proxy no servidor |

## Glossário

- **Fonte:** site ou API de onde as vagas são coletadas.
- **Conector:** módulo que busca e normaliza as vagas de uma fonte.
- **Aceita Brasil:** vaga internacional aberta a quem mora no Brasil.
- **Chance / aderência:** estimativa de 0 a 100 de quanto o perfil combina com a vaga. Não é uma probabilidade real de contratação.
- **Perfil:** versão estruturada do currículo base, editável pelo usuário.
- **ATS:** Applicant Tracking System, o sistema de triagem de currículos usado por recrutadores.
