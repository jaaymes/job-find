# PRD: Glassdoor da empresa, filtros persistentes, IA no perfil e 10 templates de CV para ATS

| Campo | Valor |
|---|---|
| Status | Rascunho |
| Autor / PO | Jaymes Costa (PO) · redação assistida |
| Data | 2026-11-25 |
| Stakeholders | Mantenedor do Job Find, contribuidores open-source |
| Versão | 0.1 |
| PRD pai | [2026-11-23-job-find-agregador-vagas-tech.md](2026-11-23-job-find-agregador-vagas-tech.md) |

## 1. Resumo

Quatro melhorias na jornada "achar a vaga → decidir → candidatar-se":

1. **Glassdoor da empresa**: um link em cada vaga para a pessoa ver avaliações, salários e entrevistas da empresa antes de aplicar.
2. **Filtros que não se perdem**: corrigir os pontos em que o estado do filtro é descartado e lembrar a última busca entre visitas. O item inclui uma auditoria de UX dos filtros.
3. **Assistente de IA no perfil**: uma entrevista guiada mais reescrita, para quem não sabe o que escrever. A IA usa só o que a pessoa contou e não inventa fatos.
4. **10 templates de CV otimizados para ATS**: todos de coluna única, variando tipografia, ordem das seções e densidade. Cada um indica para quem serve.

## 2. Contexto e problema

**Situação atual (verificada no código em 2026-11-25):**

- **Filtros.** Os filtros vivem só na URL (nuqs, `lib/client/jobs/use-jobs.ts`). O estado se perde sempre que a pessoa volta à lista por um link interno, porque todos apontam para `/` sem query:
  - "← Voltar para as vagas" e "Ver todas as vagas" no detalhe (`components/jobs/JobDetail.tsx:41` e `:127`);
  - o logo e o item "Vagas" do menu (`components/layout/SiteHeader.tsx:12`, `components/layout/nav.ts`);
  - a aba "Vagas" da barra do celular (`components/layout/MobileTabBar.tsx`).

  Só o "voltar" do navegador preserva o estado. A "busca padrão" (`lib/client/jobs/saved-search.ts`) é restaurada apenas se a pessoa a salvou de propósito, e quase ninguém salva. Resultado: a pessoa abre uma vaga, volta pelo link e precisa marcar origem, senioridade, stacks etc. de novo. Essa é a dor relatada pelo PO.
- **Perfil.** O editor (`components/profile/ProfileEditor.tsx`) é um formulário em branco. Quem não sabe escrever um resumo, um título ou bullets de experiência trava ali, e um perfil fraco gera CV fraco e score de chance ruim. Já existe IA BYOK no navegador (`lib/client/ai/*`, tarefas `extract | analyze | cv`), mas ela só é usada para importar o currículo e adaptar o CV a uma vaga. O editor também descarta alterações não salvas ao sair da página, o que é outro tipo de perda de estado.
- **CV.** Há um único layout (`lib/client/pdf/CvDocument.tsx`): coluna única, Inter, já pensado para ATS. Não há escolha de estilo nem layouts por momento de carreira (júnior, sênior, transição, vaga internacional). O perfil também não tem campos de projetos, certificações e idiomas, que pesam para júnior e para vagas internacionais.
- **Empresa.** Para avaliar a empresa, a pessoa sai do app e procura no Google ou no Glassdoor manualmente.

**Por que agora:** o índice de vagas e a geração de CV já funcionam (Fase 1). O gargalo passou a ser a qualidade do perfil e do CV, além da fricção de navegação.

## 3. Objetivos e métricas de sucesso

O Job Find não tem login nem eventos customizados de analytics. O Vercel Web Analytics guarda só pageviews agregados, com a query removida (`lib/shared/analytics.ts`). Por isso as métricas usam testes automatizados, avaliação manual e pageviews.

| Objetivo | Métrica | Baseline | Meta | Prazo |
|---|---|---|---|---|
| Filtros não se perdem | Cenários E2E de navegação (seção 6, US-02) em que algum filtro se perde | 4 de 6 rotas perdem tudo | 0 | Fase 1 |
| Glassdoor útil | % de vagas com nome de empresa válido que exibem o link | 0% | ≥ 95% | Fase 1 |
| CV legível por ATS | Templates cujo texto extraído (unpdf) mantém ordem, seções e contato corretos | 1/1 (só o atual) | 10/10 | Fase 2 |
| Perfil mais completo | Perfis de teste (10 pares) com resumo, título e ≥ 3 bullets por experiência depois de usar o assistente | medir na Fase 3 | ≥ 8/10 em teste de usabilidade com 5 pessoas | Fase 3 |
| IA não inventa | Fatos inventados (número, empresa, cargo, data, tecnologia ausente da entrada) no conjunto de avaliação | — | 0 em 30 gerações | Fase 3 |
| Uso do gerador | Razão de pageviews `/gerador/*` ÷ `/vagas/*` | medir antes | +20% em 30 dias após a Fase 2 | Fase 2 + 30 d |

**Não-objetivos**
- Não vamos coletar dados do Glassdoor (nota, avaliações, salário). Os Termos de Uso proíbem coleta automatizada (PRD pai, seção 3). Vai só um link.
- Não vamos oferecer CV em duas colunas, com foto, ícones ou gráficos de skill.
- A IA não vai escrever conteúdo "plausível" que a pessoa não informou.
- Contas, login e sincronização entre dispositivos ficam de fora: tudo continua no localStorage.

## 4. Usuários e personas

As personas são as do PRD pai: dev buscando vaga nacional ou internacional, de júnior a liderança. Destaques para estas features:

- **Ana, júnior em transição de carreira**: não sabe o que escrever e tem mais projetos do que experiência. Usa o assistente e os templates "Início de carreira" ou "Transição".
- **Bruno, sênior aplicando para fora**: quer CV em inglês, enxuto e no padrão americano, e checa a empresa no Glassdoor antes de aplicar.
- **Carla, que usa filtros finos todos os dias** (remoto + aceita Brasil + sênior + React): volta ao app várias vezes por semana e não quer remontar a busca.

## 5. Escopo

**MVP (Must)**
- Link "Ver no Glassdoor" no detalhe da vaga e no menu ⋯ do card.
- Links internos para a lista passam a carregar os filtros atuais. O "Voltar" do detalhe volta no histórico quando veio da lista, preservando a rolagem e as páginas carregadas.
- Lembrar a última busca (localStorage) e restaurá-la ao abrir a lista sem filtros na URL, com aviso e um "Limpar".
- Aviso de alterações não salvas no editor de perfil.
- Assistente de IA no perfil: "Escrever com IA" (entrevista guiada) e "Melhorar com IA" (reescrita) para título, resumo e bullets de experiência, com prévia, aceitar/editar/descartar e desfazer.
- Validador anti-invenção nas respostas do assistente.
- 10 templates de CV de coluna única, escolhidos no gerador, com template padrão salvo nas preferências.
- Perfil v2 com projetos, certificações e idiomas, migrado de forma automática e retrocompatível.
- Teste automatizado de extração de texto dos 10 templates.

**Should**
- "Revisar perfil com IA": checklist de problemas (bullet sem verbo de ação, sem resultado, resumo longo demais, skills citadas nos bullets e ausentes da lista) com "corrigir" por item.
- Sugestão de skills a partir do texto dos bullets (só termos que aparecem no texto).
- Baixar o "CV base" do perfil (sem vaga, sem adaptação) em qualquer template.
- Miniaturas estáticas dos templates no seletor.

**Could**
- Filtro de fonte com seleção múltipla (a API já aceita lista; hoje o `<select>` é único).
- Guardar o rascunho da busca por texto não enviada.
- Tamanho de página Carta (US Letter) no template Internacional.

**Fora de escopo (Won't, nesta versão)**
- Nota ou avaliações do Glassdoor dentro do app.
- Templates com duas colunas, foto, ícones, barras de nível ou cabeçalho/rodapé com dados.
- Exportar em DOCX (avaliar depois; ver Q-05).
- IA que gera experiência, métrica ou tecnologia não informada.
- Várias "buscas salvas" nomeadas (continua uma busca padrão mais a última busca).

## 6. Jornadas e user stories

**US-01: Glassdoor da empresa.** Como candidata, quero abrir a empresa da vaga no Glassdoor para avaliar cultura, salário e processo antes de aplicar.
- Dado uma vaga com empresa "Nubank", quando abro o detalhe, então vejo "Ver Nubank no Glassdoor" ao lado do nome da empresa, e ele abre em nova aba a busca do Glassdoor por "Nubank".
- Dado uma vaga nacional, então o link usa `glassdoor.com.br`; dado uma vaga internacional, então usa `glassdoor.com`.
- Dado o nome "Acme Tecnologia Ltda.", então a busca usa "Acme Tecnologia" (sufixos societários removidos).
- Dado uma empresa vazia ou genérica ("Confidencial", "Empresa confidencial", "Stealth", "Undisclosed"), então o link não aparece.
- Dado o menu ⋯ de um card, quando abro, então há o item "Ver empresa no Glassdoor".
- O app nunca faz requisição ao Glassdoor: o link é montado no cliente.

**US-02: Filtros preservados.** Como usuária frequente, quero que meus filtros continuem lá quando volto à lista.
- Dado filtros ativos na lista, quando abro uma vaga e clico em "← Voltar para as vagas", então volto à lista com os mesmos filtros, as mesmas páginas carregadas e a mesma posição de rolagem.
- Dado filtros ativos, quando vou a Perfil, Minhas vagas, Configurações ou Fontes e clico em "Vagas" (header, logo ou aba do celular), então a lista abre com os mesmos filtros.
- Dado que abri a vaga por link direto (sem histórico da lista), quando clico em "Voltar", então vou para `/?<última busca>`.
- Dado que fechei a aba com filtros ativos, quando abro o app de novo em até 7 dias pela home sem query, então a última busca é aplicada e aparece "Busca da última visita restaurada · Limpar".
- Dado que cliquei em "Limpar tudo", quando abro a home depois, então a busca padrão (se houver) é aplicada; senão, a lista abre sem filtros.
- Dado uma URL com filtros (link compartilhado), então ela sempre vence a última busca e a busca padrão.

**US-03: Escrever com IA (entrevista).** Como júnior, quero que a IA me faça perguntas e escreva o texto para mim, porque não sei o que escrever.
- Dado o campo "Resumo" vazio e uma IA configurada, quando clico em "Escrever com IA", então abre um painel com 3 a 5 perguntas curtas, geradas a partir do meu perfil (ex.: "Que tipo de produto você mais gosta de construir?", "Qual resultado do seu último trabalho te dá orgulho?").
- Quando respondo (posso pular perguntas) e clico em "Gerar", então vejo 2 opções de texto e posso escolher uma, editar e "Inserir no perfil".
- Dado que não informei números, então o texto não contém métricas. Se a IA tentar incluir um número que não está nas minhas respostas nem no perfil, a resposta é rejeitada e refeita (no máximo 2 chamadas; depois, erro claro).
- Para uma experiência, as perguntas citam a empresa e o cargo daquela experiência, e o resultado são bullets no formato verbo de ação + o quê + resultado, quando houver.

**US-04: Melhorar com IA (reescrita).** Como usuário, quero melhorar um texto que já escrevi.
- Dado um bullet "fiz o sistema de pagamentos", quando clico em "Melhorar com IA", então vejo uma comparação entre o texto atual e o sugerido (ex.: "Desenvolvi o sistema de pagamentos…"), sem fatos novos.
- Posso escolher o tom ("mais direto", "mais técnico", "em inglês") e regerar.
- Ao inserir, aparece "Desfazer" por 8 s, e nada é gravado no localStorage até "Salvar perfil".

**US-05: Sem IA configurada.** Dado que não configurei IA, quando clico em qualquer ação de IA, então vejo "Conecte uma IA para usar o assistente" com link para Configurações. O resto do editor continua funcionando.

**US-06: Alterações não salvas.** Dado que editei o perfil (à mão ou com IA) e não salvei, quando tento sair por link interno ou fechar a aba, então sou avisado ("Você tem alterações não salvas").

**US-07: Escolher template.** Como candidato, quero escolher o modelo do CV de acordo com meu momento de carreira e a vaga.
- Dado o gerador de uma vaga, quando abro "Modelo do CV", então vejo os 10 templates com nome, descrição de uma linha e "indicado para". O template recomendado para o meu perfil vem marcado.
- Quando escolho um template, então a pré-visualização em PDF é atualizada sem nova chamada à IA.
- Dado que marquei "Usar como padrão", então os próximos CVs abrem nesse template.
- Dado um template que usa projetos e o perfil sem projetos, então a seção não aparece e não sobra título vazio.

**US-08: Projetos, certificações e idiomas.** Como júnior, quero cadastrar projetos (nome, link, stacks, bullets), certificações (nome, emissor, ano) e idiomas (idioma, nível) para que entrem no CV.
- Dado um perfil v1 salvo, quando abro o app após a atualização, então ele é migrado para v2 com listas vazias, sem perder nada.

## 7. Requisitos funcionais

### 7.1 Glassdoor

| ID | Requisito | Prioridade | Critério de aceite |
|---|---|---|---|
| RF-01 | `buildGlassdoorUrl(company, origin)` em `lib/client/jobs/glassdoor.ts`, no padrão de `linkedin-search.ts` | Must | Testes unitários: domínio por origem, codificação de caracteres (acentos, `&`), sufixos removidos, `null` para nomes genéricos |
| RF-02 | Link no detalhe da vaga, junto do nome da empresa (`JobDetail.tsx`) | Must | `target=_blank`, `rel="noopener noreferrer nofollow"`, texto "(abre em nova aba)" para leitor de tela, alvo de toque ≥ 44 px |
| RF-03 | Item "Ver empresa no Glassdoor" no `JobCardMenu` | Must | Navegável por teclado; não aparece quando RF-01 devolve `null` |
| RF-04 | Normalização do nome: remove Ltda, Ltda., S.A., S/A, ME, EIRELI, Inc, Inc., LLC, Ltd, GmbH, Corp e o conteúdo entre parênteses; corta espaços | Must | Tabela de casos no teste |

### 7.2 Filtros

| ID | Requisito | Prioridade | Critério de aceite |
|---|---|---|---|
| RF-10 | Store `jobfind:v1:lastFilters` (mesmo schema de `SavedFilters`, sem `showHidden`) com `savedAt` | Must | Atualizada a cada mudança de filtro na lista (debounce de 300 ms); "Limpar tudo" grava `null` |
| RF-11 | Hook `useJobsListHref()` que devolve `/` mais a query da última busca, serializada pelo mesmo parser do nuqs | Must | Usado no logo, no item "Vagas" do header, na aba "Vagas" do celular, no "Voltar" e no "Ver todas as vagas" |
| RF-12 | "Voltar para as vagas" usa `router.back()` quando a página anterior do histórico é a lista; senão, navega para RF-11 | Must | E2E: filtros, páginas carregadas ("Carregar mais") e rolagem preservados |
| RF-13 | Restauração na abertura, com precedência: query da URL > última busca (≤ 7 dias) > busca padrão > nada | Must | Estende `useApplySavedSearch`; a consulta de vagas só sai depois da decisão (mantém o `ready` atual) |
| RF-14 | Aviso não intrusivo "Busca da última visita restaurada · Limpar" quando a última busca é aplicada | Must | `role="status"`; some ao mudar qualquer filtro |
| RF-15 | Filtro de fonte com seleção múltipla | Could | Chips ativos mostram todas as fontes escolhidas |
| RF-16 | Busca por texto não enviada é mantida ao trocar outro filtro | Could | — |

### 7.3 Assistente de IA no perfil

| ID | Requisito | Prioridade | Critério de aceite |
|---|---|---|---|
| RF-20 | Botões "Escrever com IA" (campo vazio) e "Melhorar com IA" (campo preenchido) em título, resumo e no conjunto de bullets de cada experiência | Must | Aparecem só com o editor aberto; com IA ausente, abrem o aviso da US-05 |
| RF-21 | Fluxo de entrevista: (1) IA gera 3–5 perguntas com o contexto do perfil; (2) usuário responde ou pula; (3) IA gera 2 opções | Must | Duas chamadas ao modelo no caminho feliz; streaming de texto parcial; botão "Cancelar" aborta (`AbortSignal`) |
| RF-22 | Fluxo de reescrita com tons: padrão, mais direto, mais técnico, traduzir (pt/en/es) | Must | Comparação lado a lado no desktop e empilhada no celular |
| RF-23 | Prévia editável → "Inserir no perfil" altera só o rascunho do editor; "Desfazer" por 8 s | Must | Nada vai ao localStorage sem "Salvar perfil" |
| RF-24 | Validador anti-invenção (RN-20) no `validate` do `generate.ts` | Must | Testes unitários com casos de número, empresa e tecnologia inventados |
| RF-25 | Prompts versionados em `lib/client/ai/prompts/profile.assist.v1.ts` (perguntas, redação, reescrita), seguindo `shared.ts` e `untrusted.ts` | Must | Entram no `pnpm eval:ai` com um conjunto de 10 perfis |
| RF-26 | Aviso de alterações não salvas no editor (navegação interna e `beforeunload`) | Must | E2E da US-06 |
| RF-27 | "Revisar perfil com IA": lista de achados com "Corrigir" (abre RF-22 no item) | Should | Achados determinísticos (sem IA): bullet sem verbo no início, > 2 linhas, resumo > 600 caracteres; achados com IA marcados como sugestão |
| RF-28 | Sugerir skills presentes no texto dos bullets e ausentes da lista, usando o dicionário `lib/shared/stacks.ts` | Should | Determinístico, sem IA; o usuário aceita uma por uma |

### 7.4 Templates de CV

| ID | Requisito | Prioridade | Critério de aceite |
|---|---|---|---|
| RF-30 | Registro de templates `lib/client/pdf/templates/` com `id`, nome, descrição, "indicado para", fonte, ordem das seções e tokens de estilo; `CvDocument` passa a receber `templateId` | Must | O template atual vira `classico` e é o padrão; CVs já gerados continuam abrindo nele |
| RF-31 | Os 10 templates da seção 11.2 | Must | Cada um passa no RNF-10 |
| RF-32 | Seletor "Modelo do CV" no gerador, com recomendação automática (RN-31) e "Usar como padrão" | Must | Trocar o template não chama a IA de novo |
| RF-33 | Preferência `templateId` persistida (nova chave `jobfind:v1:cvPrefs` ou campo no registro gerado; decisão do tech lead) | Must | Sobrevive a recarregar a página e entra no backup (`lib/client/storage/backup.ts`) |
| RF-34 | Perfil v2: `projects[]`, `certifications[]`, `languages[]`, com editores no perfil e migração v1 → v2 | Must | Teste de migração; a extração por IA (`profile.extract`) passa a preencher esses campos |
| RF-35 | Seções novas no PDF (Projetos, Certificações, Idiomas) com rótulos em pt/en/es | Must | Vêm do perfil, sem passar pela IA de adaptação (RN-07 camada 1) |
| RF-36 | Fontes adicionais embutidas (TTF, licença OFL) em `public/fonts` | Must | Licenças versionadas ao lado dos arquivos; peso total de fontes novas ≤ 1,5 MB |
| RF-37 | Baixar "CV base" pelo perfil, sem vaga, em qualquer template | Should | Usa o texto do perfil como está |
| RF-38 | Miniaturas PNG estáticas dos templates, geradas por script com um perfil fictício | Should | Script em `scripts/`; imagens ≤ 40 KB cada. **Atendido pela galeria renderizada no navegador** (spec `docs/tech/2026-11-26-galeria-modelos-cv-e-assistente-visivel.md`): as miniaturas A4 usam o currículo do próprio usuário, sem PNGs estáticos |

## 8. Regras de negócio

| ID | Regra | Exceções |
|---|---|---|
| RN-07 (mantida) | O CV só reordena, resume e reescreve o que está no perfil | — |
| RN-10 | O link do Glassdoor é só um link de busca montado no cliente; o app não consulta, não guarda e não exibe dados do Glassdoor | — |
| RN-11 | Domínio: `glassdoor.com.br` quando `origin = national`; `glassdoor.com` nos demais casos | Origem desconhecida → `.com.br` (o público é brasileiro) |
| RN-12 | Nomes genéricos ou vazios não geram link (lista em RF-04 mais "Confidencial", "Confidential", "Stealth", "Undisclosed", "Empresa") | — |
| RN-15 | Precedência dos filtros na abertura da lista: URL > última busca (≤ 7 dias) > busca padrão > vazio | "Limpar tudo" apaga a última busca |
| RN-16 | `ocultas` (mostrar vagas ocultas) nunca é restaurado nem salvo | — |
| RN-17 | A última busca e a busca padrão ficam só no localStorage, como o resto dos dados do usuário | — |
| RN-20 | Anti-invenção do assistente: todo número (inteiro, %, valor, duração) da saída precisa aparecer na entrada (perfil + respostas); toda empresa e todo cargo citados precisam existir no perfil; toda tecnologia do dicionário de stacks citada precisa aparecer na entrada | Números escritos por extenso contam como número; datas vêm só do perfil |
| RN-21 | O assistente só altera o rascunho do editor; a gravação continua manual ("Salvar perfil") | — |
| RN-22 | As perguntas da entrevista não pedem dados sensíveis (idade, estado civil, saúde, religião, CPF, endereço completo) | — |
| RN-30 | Todo template: coluna única, sem tabelas, imagens, ícones nem caixas de texto; nada de conteúdo em elementos `fixed` (cabeçalho/rodapé); títulos de seção padrão no idioma do CV; nome como primeira linha de texto; contato em texto simples no corpo (e-mail, telefone, cidade/país, URLs completas e visíveis) | — |
| RN-31 | Recomendação de template: júnior ou sem experiência → `inicio-de-carreira`; perfil com projetos e experiência fora de tech → `transicao`; vaga em inglês → `internacional`; senioridade `lead` → `lideranca`; `senior` → `resultados`; demais → `classico` | O padrão escolhido pelo usuário vence a recomendação |
| RN-32 | Cor só como acento em títulos e linhas, com contraste ≥ 4.5:1 sobre branco; o texto corrido é sempre preto ou cinza-escuro | — |

## 9. Requisitos não funcionais

| ID | Requisito | Meta |
|---|---|---|
| RNF-01 | Restauração de filtros não pode causar "piscar" da lista sem filtros | 0 requisições a `/api/jobs` sem os filtros restaurados (teste) |
| RNF-02 | Gravação da última busca não pode travar a interação | Debounce de 300 ms; escrita < 5 ms |
| RNF-03 | Privacidade: perfil, respostas da entrevista e textos vão do navegador direto ao provedor de IA do usuário (BYOK); nada passa pelo servidor do Job Find | Revisão da CSP (`lib/shared/csp.ts`) sem novos hosts além dos provedores já liberados |
| RNF-04 | Respostas da entrevista não são persistidas depois que o painel fecha | Verificado em teste |
| RNF-05 | Acessibilidade: painel do assistente com foco gerenciado, `aria-live` para o streaming, operação completa por teclado, alvos ≥ 44 px | Checagem com axe nos E2E das telas novas |
| RNF-06 | Custo: assistente funciona com os modelos gratuitos do OpenRouter já recomendados | Eval roda com o modelo padrão gratuito |
| RNF-10 | ATS: para cada template, o texto extraído com `unpdf` de um PDF gerado com um perfil fictício completo traz, na ordem: nome, título, contato, e as seções na ordem do template; e-mail e telefone reconhecíveis por regex; nenhuma palavra hifenizada ou colada | Teste automatizado, 10/10 |
| RNF-11 | Geração do PDF no navegador | ≤ 2 s no p95 num notebook médio para CV de 2 páginas |
| RNF-12 | Metadados do PDF: `title`, `author` (nome), `subject` (cargo-alvo) e `keywords` (skills) preenchidos | Teste unitário |

## 10. Visão técnica

**Módulos afetados**
- Glassdoor: novo `lib/client/jobs/glassdoor.ts`, `components/jobs/JobDetail.tsx`, `components/jobs/JobCardMenu.tsx` (nova prop `glassdoorUrl`).
- Filtros: `lib/client/jobs/use-jobs.ts` (exportar o serializador via `createSerializer` do nuqs), `lib/client/jobs/saved-search.ts` (precedência e `lastFilters`), `lib/client/storage/keys.ts` (nova chave), `components/jobs/JobsPage.tsx`, `components/jobs/JobDetail.tsx` (`BackLink`), `components/layout/SiteHeader.tsx`, `components/layout/nav.ts`, `components/layout/MobileTabBar.tsx`. Rolagem e páginas carregadas se preservam com `router.back()` e o cache do React Query (`keepPreviousData` já existe).
- IA no perfil: `components/profile/ProfileEditor.tsx`, `ExperienceEditor.tsx`, novo `components/profile/assistant/*` (painel em Sheet no celular, popover/painel lateral no desktop), novos prompts em `lib/client/ai/prompts/profile.assist.v1.ts`, reutilizando `lib/client/ai/generate.ts` (schema Zod, `validate`, streaming, `MAX_CALLS = 2`).
- Modelo de IA: reutilizar o modelo da tarefa `cv` (premissa P-03), sem nova tarefa em `AiTask` nem nova tela de configuração.
- Templates: `lib/client/pdf/CvDocument.tsx` vira um renderizador guiado por template; novo `lib/client/pdf/templates/{registry.ts, tokens.ts}`; `lib/client/pdf/fonts.ts` registra várias famílias sob demanda; `components/generator/GeneratorScreen.tsx` ganha o seletor.
- Perfil v2: `lib/shared/schemas/profile.ts` (`PROFILE_SCHEMA_VERSION = 2`), migração em `lib/client/profile/store.ts` via `migrations` do `createStore`, `profile.extract.v1` → `v2` para os campos novos, editores novos em `components/profile/`.

**Dados (localStorage)**
- `jobfind:v1:lastFilters`: `{ filters: SavedFilters, savedAt: ISO }` ou `null`.
- `jobfind:v1:profile`: v1 → v2 com `projects: { id, name, link|null, stacks: string[], bullets: {id,text}[] }[]`, `certifications: { name, issuer|null, year|null }[]` e `languages: { name, level: enum }[]`. Todos os campos são obrigatórios, usando `nullable` (exigência dos provedores com `json_schema` estrito, como já documentado no schema).
- Preferência de template (RF-33).
- Backup e importação (`lib/client/storage/backup.ts`) passam a incluir as chaves novas.

**APIs:** nenhuma rota nova no servidor. `/api/jobs` não muda.

**Segurança**
- Os textos do perfil são do próprio usuário. Mesmo assim, entram no prompt como dados delimitados (`untrusted.ts`), para não virarem instruções.
- O link do Glassdoor passa por `safeExternalUrl`.

**Integrações externas:** Glassdoor só como link. Formato da URL de busca a confirmar num spike (Q-01). Fallback: busca no Google restrita ao site do Glassdoor.

**Rollout:** sem feature flag (regra do projeto: entregar já ativo). Entrega em 3 PRs, uma por fase. A migração do perfil é automática e só para frente; o backup exportado antes continua importável.

**Observabilidade:** sem eventos customizados (pago na Vercel; fora da regra de serviços gratuitos). Acompanhar pageviews de `/perfil` e `/gerador/*` e as issues do GitHub.

**Testes**
- Unitários: `glassdoor.ts`, precedência de filtros, serialização do href, validador RN-20, migração v1 → v2, recomendação RN-31, metadados do PDF.
- Integração/node: extração com `unpdf` dos 10 templates (RNF-10).
- E2E (Playwright): as 6 rotas da US-02, US-06, fluxo do assistente com provedor falso.
- IA: `pnpm eval:ai` com 10 perfis × 3 fluxos, revisão manual de invenções.

**Alternativas consideradas**
- *Filtros em localStorage como fonte da verdade*: descartada. A URL continua sendo a fonte da verdade (compartilhável); o localStorage só reabastece a URL.
- *Página do Glassdoor exata (com ID)*: exige consultar o Glassdoor, o que fere a RN-09/ToS. Descartada.
- *Templates em duas colunas*: as evidências de que funcionam vêm de fornecedores e são conflitantes, e a Workday é citada como problemática. Descartada (decisão do PO).
- *Nova tarefa de IA `assist` com modelo próprio*: adiada. Exigiria mexer na tela de configurações; reutilizar `cv` é suficiente para começar.

## 11. UX / UI

### 11.1 Auditoria dos filtros (estado atual)

| # | Achado | Severidade | Ação |
|---|---|---|---|
| A1 | Todo link interno de volta à lista descarta os filtros | Alta | RF-11, RF-12 |
| A2 | Ao voltar pelo link, perdem-se as páginas carregadas e a rolagem | Alta | RF-12 |
| A3 | Nada é lembrado entre visitas, a não ser que a pessoa salve uma "busca padrão" | Alta | RF-10, RF-13 |
| A4 | "Salvar como busca padrão" fica no fim do painel, e o conceito não é óbvio | Média | Manter, mas com texto de ajuda: "Abre sempre com estes filtros quando não houver uma busca recente" |
| A5 | Fonte, chance e idioma são de escolha única, embora a API aceite lista para fonte | Baixa | RF-15 (Could) |
| A6 | A busca por texto só vale ao enviar; texto digitado e não enviado some ao trocar um filtro | Baixa | RF-16 (Could) |
| A7 | No celular, os filtros aplicam na hora e o rodapé "Ver N vagas" mostra o total | OK | Manter |
| A8 | Chips de filtros ativos com remoção individual e "Limpar tudo" | OK | Manter; "Limpar tudo" passa a apagar a última busca |
| A9 | O contador "Filtros (n)" não inclui stacks nem modo de trabalho (eles têm controle próprio) | Baixa | Manter, documentado |

### 11.2 Os 10 templates

Todos seguem a RN-30 e a RN-32. A pesquisa (fontes abaixo) converge em: coluna única, títulos padrão, fontes comuns, PDF com texto selecionável e contato fora de cabeçalho/rodapé.

| # | id | Nome | Indicado para | Ordem das seções | Tipografia / estilo |
|---|---|---|---|---|---|
| 1 | `classico` | Clássico | Qualquer perfil (padrão atual) | Resumo → Experiência → Competências → Projetos → Formação → Certificações → Idiomas | Inter 10 pt, títulos com linha |
| 2 | `compacto` | Compacto técnico | Devs com muita experiência para caber em 1 página | Competências agrupadas → Experiência → Projetos → Formação | Inter 9,5 pt, margens menores, títulos em versalete |
| 3 | `harvard` | Harvard | Perfis com formação forte e vagas corporativas ou acadêmicas | Formação → Experiência → Projetos → Competências → Idiomas | Serif (Source Serif 4), nome centralizado |
| 4 | `minimalista` | Minimalista | Quem quer leitura limpa | Resumo → Experiência → Competências → Formação | Source Sans 3, sem linhas, mais respiro |
| 5 | `moderno` | Moderno com acento | Produto e front-end, startups | Resumo → Competências → Experiência → Projetos → Formação | IBM Plex Sans, títulos em azul-escuro (RN-32) |
| 6 | `resultados` | Foco em resultados | Sênior | Resumo → Destaques (3 bullets do perfil marcados pelo usuário) → Experiência → Competências → Formação | Inter, destaques em negrito |
| 7 | `lideranca` | Liderança | Tech lead, staff, gestão | Resumo → Áreas de atuação → Experiência → Formação → Certificações | Serif nos títulos e sans no corpo |
| 8 | `inicio-de-carreira` | Início de carreira | Estágio e júnior | Resumo → Competências → Projetos → Formação → Experiência → Certificações | Inter, projetos em destaque |
| 9 | `transicao` | Transição de carreira | Quem vem de outra área | Resumo → Competências relevantes → Projetos → Experiência (inclui a anterior) → Formação | Source Sans 3 |
| 10 | `internacional` | Internacional (EUA/remoto) | Vagas em inglês | Summary → Experience → Skills → Projects → Education → Languages | Inter; rótulos sempre no idioma do CV; linha "Location: Cidade, Brasil · Open to remote"; sem dados pessoais além de contato |

"Destaques" (template 6) usa bullets existentes que o usuário marca com uma estrela no editor; não é texto novo. Adicionar a flag `highlight` no bullet faz parte do perfil v2.

### 11.3 Assistente de IA

- Gatilho: botão secundário com ícone de brilho ao lado do rótulo do campo ("Escrever com IA" / "Melhorar com IA").
- Painel: Sheet no celular; painel ancorado ao campo no desktop. Etapas: Perguntas → Gerando (streaming) → Opções → Inserir.
- Estados: sem IA (CTA para Configurações), carregando, erro do provedor (mensagens já existentes em `lib/client/ai/errors.ts`), rejeição do validador ("A IA tentou incluir informações que você não deu. Tente de novo ou responda mais perguntas.").
- Texto fixo no painel: "A IA só usa o que você contou. Revise antes de salvar."

## 12. Dependências e restrições

- Licenças das fontes: Inter, Source Serif 4, Source Sans 3 e IBM Plex Sans são OFL (gratuitas e embutíveis em PDF).
- Termos do Glassdoor: só link, sem coleta (RN-09 do PRD pai).
- Regras do projeto: sem env/feature flag novos; só serviços gratuitos; textos em pt-BR.
- `@react-pdf/renderer` não suporta colunas nativas, o que reforça a coluna única.

## 13. Riscos e premissas

| Item | Tipo | Prob. / Impacto | Mitigação ou validação |
|---|---|---|---|
| R-01 A URL de busca do Glassdoor muda ou exige login | Risco | Média / Baixo | Spike Q-01; função isolada em um arquivo; fallback para busca no Google |
| R-02 Restaurar a última busca confunde quem queria começar do zero | Risco | Média / Médio | Aviso RF-14 com "Limpar"; validade de 7 dias |
| R-03 A IA inventa fatos mesmo com prompt e validador | Risco | Média / Alto | RN-20 com retentativa, prévia obrigatória, eval com 30 gerações, texto "revise antes de salvar" |
| R-04 Modelos gratuitos respondem mal ao formato de perguntas | Risco | Média / Médio | Schema Zod estrito, `jsonrepair` (já usado), eval com o modelo padrão |
| R-05 Dez templates parecidos demais ("são todos iguais") | Risco | Média / Baixo | Diferenciar por público e ordem das seções; miniaturas (RF-38) |
| R-06 Fontes novas deixam o bundle pesado | Risco | Baixa / Médio | Carregar a fonte do template sob demanda; limite RF-36 |
| R-07 Migração do perfil v2 corrompe dados | Risco | Baixa / Alto | Teste de migração com fixtures reais; o backup continua importável |
| P-01 Coluna única é o formato mais seguro entre os ATS usados no Brasil (Gupy, Kenoby, Workday, Greenhouse, Lever) | Premissa | — | Pesquisa abaixo; validar subindo os PDFs no Gupy e no Greenhouse de teste (Q-04) |
| P-02 7 dias é uma boa validade para a última busca | Premissa | — | Revisar após o uso |
| P-03 O modelo da tarefa `cv` serve para o assistente | Premissa | — | Eval na Fase 3 |

## 14. Plano de entrega

| Fase | Conteúdo | Pronto quando |
|---|---|---|
| 1. Navegação | RF-01..04, RF-10..14, RF-26 | E2E da US-02 e da US-06 verdes; link do Glassdoor validado manualmente em 10 empresas |
| 2. Templates | RF-30..36 (+ RF-37/38 se couber) | RNF-10 10/10; migração v2 testada; seletor no gerador |
| 3. Assistente de IA | RF-20..25 (+ RF-27/28 se couber) | Eval sem invenções; teste de usabilidade com 5 pessoas |

Cada fase vira um PR com spec técnica em `docs/tech/` e plano em `docs/plans/`. Depois de cada entrega, acompanhar as métricas da seção 3.

## 15. Perguntas em aberto

| # | Pergunta | Responsável | Impacto se sem resposta | Status |
|---|---|---|---|---|
| Q-01 | Qual URL de busca do Glassdoor funciona sem login no .com.br e no .com (ex.: `/Search/results.htm?keyword=`)? | Tech lead (spike de 30 min) | Link quebrado; usar o fallback do Google | Aberta |
| Q-02 | A última busca deve guardar também a busca por texto (`q`)? | PO | Hoje a proposta guarda; é texto digitado, mas fica só no navegador | Proposta: sim |
| Q-03 | Validade de 7 dias para a última busca está boa? | PO | Restaura busca velha demais ou expira cedo | Proposta: 7 dias |
| Q-04 | Há como testar os PDFs em ATS reais (conta de teste no Gupy ou Greenhouse)? | PO | Validação da RNF-10 fica só sintética | Aberta |
| Q-05 | Vale oferecer DOCX numa versão futura? Alguns ATS e recrutadores preferem | PO | Nenhum agora | Adiada |
| Q-06 | Os templates escolhidos devem valer também para a carta de apresentação? | PO | Carta continua com o layout atual | Proposta: não nesta versão |

## 16. Registro de decisões

| Data | Decisão | Motivo | Alternativas descartadas |
|---|---|---|---|
| 2026-11-25 | IA no perfil = entrevista guiada + reescrita, sem conteúdo novo | Mantém a RN-07 e a confiança no CV; resolve o "não sei o que escrever" | Sugestão com lacunas; sugestão livre |
| 2026-11-25 | 10 templates, todos de coluna única | Formato mais seguro para ATS segundo a pesquisa | 6 templates; 10 com duas colunas |
| 2026-11-25 | Lembrar a última busca, além de corrigir os links | A dor é recorrente entre visitas, não só na navegação | Só corrigir os links |
| 2026-11-25 | Glassdoor no detalhe e no menu ⋯ do card | Acesso rápido sem poluir a lista | Só no detalhe; ícone no card |
| 2026-11-25 | URL continua sendo a fonte da verdade dos filtros | Links compartilháveis; o localStorage só reabastece | localStorage como fonte |

## Glossário

- **ATS** (Applicant Tracking System): sistema de recrutamento que extrai o texto do CV para busca e triagem (Gupy, Workday, Greenhouse, Lever…).
- **Última busca**: filtros da última sessão na lista, guardados automaticamente.
- **Busca padrão**: filtros salvos de propósito pelo usuário (RF-22 do PRD pai).
- **BYOK**: o usuário traz a própria chave de IA; as chamadas vão do navegador ao provedor.

## Referências da pesquisa (2026-11-25)

- Jobscan: [Can ATS read tables and columns?](https://www.jobscan.co/blog/resume-tables-columns-ats/) e [ATS templates](https://jobscan.co/resume-templates/ats-templates)
- Workable: [How an ATS reads a resume](https://resources.workable.com/blog/how-ATS-reads-resumes/)
- Toptal: [ATS-friendly resumes: formatting and common mistakes](https://www.toptal.com/resume/career-center/ats-friendly-resumes-formatting-examples-and-common-mistakes)
- Enhancv (fornecedor; defende duas colunas): [Two-column resume ATS test](https://enhancv.com/blog/two-column-resume-ats-test/) e [ATS resume parsing](https://enhancv.com/blog/ats-resume-parsing/)
- atsverification.com (fornecedor): [ATS parsing benchmark 2026](https://atsverification.com/blog/ats-parsing-benchmark-2026/)
- Adobe: [Resume formatting mistakes](https://www.adobe.com/acrobat/resources/resume-formatting-mistakes.html)
- Rezi: [ATS-friendly templates are misleading](https://www.rezi.ai/posts/ats-friendly-templates-are-misleading)
- Formato das páginas de empresa do Glassdoor (`/Reviews/<Empresa>-Reviews-E<id>.htm`, o ID exige consulta): [SerpApi Glassdoor Reviews API](https://serpapi.com/glassdoor-reviews-api)
