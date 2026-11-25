# Redesign de UX/UI do desktop e nova UI mobile

| | |
|---|---|
| **Data** | 2026-11-24 |
| **Status** | Proposta, aguardando aprovação |
| **PRD de origem** | Não há PRD próprio. Requisitos vêm do pedido do usuário e do [PRD geral](../prd/2026-11-23-job-find-agregador-vagas-tech.md). Ver "Premissas". |
| **Design** | [Canvas no Claude Design](https://claude.ai/artifact/GBEFUsdUZXkckBagLg7jtK) · [Design System Job Find](https://claude.ai/artifact/GPYm42oZ7ZsbaSUmJBck4i) |
| **Evidências** | Capturas em `docs/design/auditoria-2026-11-24/` (1440×900 e 390×844, claro) |

## 1. Contexto e objetivo

Fiz uma auditoria de UX/UI do Job Find e, a partir dela, redesenhei o desktop e criei uma interface própria para celular. Três decisões foram tomadas com o usuário antes do design:

1. **Refinar a identidade atual** em vez de trocar a linguagem visual. Continuam a lupa-J, o azul `jf-brand`, Space Grotesk com Inter e os tokens `jf-*`.
2. **Criar o Design System do Job Find no Claude Design**, reaproveitável em telas futuras.
3. **No mobile, barra de abas inferior** (Vagas, Minhas vagas, Perfil, Mais).

### Requisitos derivados

| ID | Requisito |
|---|---|
| RF-01 | A pessoa vê a primeira vaga sem rolar: no desktop, cards acima da dobra em 1440×900; no celular, card visível em 390×844 sem rolar. |
| RF-02 | O próximo passo do setup (IA → currículo) fica sempre visível e leva de volta à vaga de onde a pessoa saiu. |
| RF-03 | Abaixo de 768px, a navegação principal é uma barra de abas inferior. |
| RF-04 | Abaixo de 1024px, os filtros abrem num bottom sheet com contagem ao vivo ("Ver N vagas"). |
| RF-05 | Na vaga em celular, as ações (Salvar, Gerar CV, Candidatar-se) ficam numa barra fixa no rodapé. |
| RF-06 | O gerador funciona no celular, com abas Editar e Pré-visualizar e pré-visualização legível. |
| RF-07 | O card da lista mostra só uma ação rápida (salvar). Status e "Ocultar" vão para o menu "⋯" e para a página da vaga. |
| RNF-01 | WCAG 2.2 AA: texto com 4.5:1, bordas de controle e foco com 3:1, nos dois temas. |
| RNF-02 | No celular, todo alvo de toque tem pelo menos 44px e campos de texto usam fonte de 16px ou mais. |
| RNF-03 | Safe-area do iOS respeitada (`viewport-fit=cover`, `env(safe-area-inset-*)`). |
| RNF-04 | Nenhuma dependência nova obrigatória. pdf.js fica como opção, ver D-07. |

## 2. Resultado da auditoria

Três especialistas analisaram as telas em paralelo. Todos usaram a skill `impeccable`, só leram e não editaram nada.

| Especialista | Nota | Principais achados |
|---|---|---|
| Crítica UX, desktop (`impeccable critique`) | **26/40** Nielsen, Aceitável | O setup fica escondido atrás de 3 saltos. O CTA "Importe seu currículo para ver" se repete em cada card. Os resultados ficam abaixo da dobra. Cada card tem uma coluna de ações. "Gerar CV + carta" leva a um beco sem saída. Minhas vagas tem 7 abas com conceitos que se sobrepõem. |
| Auditoria técnica (`impeccable audit`, Playwright) | **14/20**, Bom | Botão primário com 2,76:1 no escuro. Borda de input com 1,60:1. Anel de foco do shadcn com cerca de 1,5:1. Duas camadas de tokens (`jf-*` e shadcn). `styles.ts` funciona como um design system paralelo. Nenhum estouro horizontal. |
| Adaptação mobile (`impeccable adapt`) | — | O header ocupa cerca de 170px em 2 linhas. A 1ª vaga só aparece depois de 1,9 tela. O card tem cerca de 510px. O PDF em `<iframe>` não renderiza no Chrome Android. Não existe Sheet/Drawer em `components/ui`. A safe-area não é tratada. |

### Problemas consolidados, por severidade

**P1**

| Problema | Evidência | Decisão |
|---|---|---|
| Pré-requisitos do setup escondidos | `ProfileScreen.tsx:70`, `ChanceBadge.tsx:15-22` | D-03 |
| CTA de chance repetido em todo card | `desktop-home.png` | D-03 |
| Lista abaixo da dobra (desktop y≈490, celular 1,9 tela) | `desktop-home.png`, `mobile-home.png` | D-04 |
| Ações em todo card | `JobCard.tsx:110-117` | D-05 |
| Beco sem saída no gerador | `desktop-gerador.png` | D-03 |
| Branco sobre a marca no escuro (2,76:1) | `components/ui/styles.ts:8` | D-01 |
| Borda de campo com 1,60:1 | `--jf-line-strong` | D-01 |
| Anel de foco do shadcn invisível | `button.tsx:6` | D-01 |
| Nav mobile em 2 linhas, longe do polegar | `SiteHeader.tsx:43,62` | D-06 |
| PDF não renderiza no celular | `PdfPreview.tsx:68` | D-07 |

**P2**

| Problema | Evidência | Decisão |
|---|---|---|
| Filtros espalhados; "Limpar" zera também a busca | `JobsPage.tsx:108` | D-04 |
| Descrição da vaga num bloco único | `desktop-vaga-2.png` | D-08 |
| Pedido de currículo duplicado no detalhe | `JobDetail.tsx:191`, `AiAnalysis.tsx` | D-08 |
| Minhas vagas com 7 abas | `Board.tsx:139-147` | D-09 |
| Configurações com 6 CTAs de mesmo peso | `desktop-configuracoes.png` | D-10 |
| Alvos de toque menores que 44px | `StackChips.tsx:69,73`, `FiltersPanel.tsx:58`, `SiteFooter` | D-11 |
| Estrela âmbar com 2,15:1 | `JobActions.tsx:80` | D-01 |
| Toasts e "Desfazer" em `bottom-4` | `JobsPage.tsx:260` | D-06 |

**P3**

| Problema | Evidência | Decisão |
|---|---|---|
| `animate-pulse` ignora movimento reduzido | 9 skeletons | D-11 |
| Falta link "pular para o conteúdo" | todas as rotas | D-11 |
| Fontes com 17 alertas âmbar iguais | `desktop-fontes.png` | D-10 |
| h1 do Perfil fora do `font-display` | `ProfileScreen.tsx:64` | D-11 |

## 3. Decisões

### D-01 Unificar tokens: shadcn aponta para `jf-*`, e três tokens novos

- **Contexto:** os componentes shadcn usam oklch neutro (o `--primary` é quase preto e o `--ring` fica a 50%). O resto do app usa `jf-*`, e isso gera três falhas de contraste P1.
- **Opções:**
  - (a) Mapear as variáveis shadcn para `jf-*` em `globals.css`.
  - (b) Reescrever os componentes para usar `jf-*` direto.
  - (c) Manter as duas camadas.
- **Decisão:** **(a)**. Mapear `--primary→jf-brand`, `--primary-foreground→jf-on-brand`, `--background/--card/--popover→jf-surface`, `--muted→jf-chip`, `--muted-foreground→jf-ink-3`, `--border→jf-line`, `--input→jf-field-border`, `--ring→jf-brand` (opaco) e `--destructive→jf-danger-fg`. São três tokens novos:

  | Token | Claro | Escuro | Função |
  |---|---|---|---|
  | `--jf-on-brand` | `#ffffff` | `#121418` | Texto sobre a marca |
  | `--jf-field-border` | `#8f8b82` | `#5a606b` | Borda de campos, 3:1 |
  | `--jf-fav` | `#b45309` | `#f59e0b` | Estrela de favorito |

- **Consequências:**
  - Corrige os 3 P1 de contraste numa só edição.
  - O `tests/unit/shared/palette.test.ts` ganha os pares novos.
  - No escuro, o hover do primário escurece em vez de clarear.
  - Os tokens já estão no Design System, marcados como PROPOSTO. *(base: auditoria técnica)*

### D-02 Um só sistema de botões e campos

- **Contexto:** hoje `styles.ts` tem 44 `BTN_OUTLINE`, 15 `BTN_PRIMARY`, 37 `FIELD` e 41 `CARD` em strings de classe, convivendo com `button.tsx`, que tem 32px de altura padrão.
- **Opções:**
  - (a) Variantes `cva` em `components/ui/button.tsx`, com 44px no mobile e 36px no desktop, e `styles.ts` reexportando as variantes.
  - (b) Manter as strings.
- **Decisão:** **(a)**, feita de forma incremental. Primeiro `styles.ts` passa a chamar `buttonVariants`, sem mexer nos 40 chamadores; a migração dos chamadores vem depois, arquivo por arquivo.
- **Consequências:** o risco de regressão visual é baixo. O E2E usa seletores por papel, não por classe. *(base: auditoria técnica)*

### D-03 Checklist de setup único e retorno à vaga

- **Contexto:** a chance de entrevista, valor central do produto, depende de IA + currículo, mas nada mostra isso. O caminho é card → /perfil → /configuracoes → OAuth → /perfil → lista, sem voltar à vaga.
- **Opções:**
  - (a) Um componente `SetupProgress` (passo N/3) que aparece em três lugares: banner acima da lista, card "Sua aderência" no detalhe e estado vazio no gerador.
  - (b) Onboarding obrigatório em modal.
  - (c) Manter a pílula por card.
- **Decisão:** **(a)**.
  - O estado vem do `aiStore` e do `profileStore`, que já existem.
  - Os links de setup carregam `?voltar=/vagas/<id>` (validado como caminho relativo interno, para não virar open redirect) e, ao concluir, levam de volta à vaga.
  - Sem currículo, o `ChanceBadge` some do card.
  - No header desktop entra um indicador "IA ✓ · Currículo —".
  - "Gerar CV + carta" fica desabilitado, com o motivo visível no botão.
- **Consequências:**
  - Toca `ChanceBadge`, `JobCard`, `JobsPage`, `JobDetail`, `AiAnalysis` e `GeneratorScreen`, e cria um componente novo.
  - O `?voltar` precisa de validação: allowlist de prefixo `/vagas/` e `/gerador/`. *(base: crítica UX)*

### D-04 Topo da lista compacto e filtros reorganizados

- **Desktop:**
  - h1 e subtítulo na mesma linha.
  - O alerta de coleta atrasada vira texto âmbar no subtítulo ("atualizado há 4 h · por quê?"); a explicação completa fica em /fontes.
  - Busca, período e Buscar numa faixa só; stacks numa linha com "+75".
  - Acima da lista: abas de modo, ordenar ("Mais recentes" / "Maior chance") e chips de filtros ativos com "Limpar tudo".
  - O "Limpar filtros" da sidebar deixa de apagar a busca.
  - O link do LinkedIn vai para o fim da lista.
- **Celular:**
  - Título de 24px e chip "Atualizado há 4 h".
  - Busca em largura total com fonte de 16px; stacks em faixa horizontal rolável.
  - Barra sticky "Filtros (n) · N vagas · Todas ▾".
  - O período entra no sheet de filtros.
- **Alternativa descartada:** manter a sidebar no tablet. Entre 768 e 1023px ela espreme os cards.
- **Consequências:** cerca de 300px a menos antes do 1º card no desktop. *(base: crítica UX e mobile)*

### D-05 Card de vaga com uma ação

- **Decisão:**
  - O card inteiro vira link estendido (`::after` cobrindo o card a partir do link do título), o que mantém um único alvo de foco.
  - Fica visível só a estrela, com `aria-pressed`, mais um menu "⋯": Mudar status, Ocultar, Copiar link.
  - No celular o card fica com cerca de 160px: até 3 pílulas e "+n".
- **Alternativa descartada:** botões que aparecem só no hover. Não funciona no toque nem é descoberto pelo teclado.
- **Consequências:**
  - `JobCard.tsx` e `JobActions.tsx` mudam.
  - O "Desfazer" de ocultar continua igual.
  - Os seletores do E2E de ocultar/status passam a abrir o menu. *(base: crítica UX e mobile)*

### D-06 Navegação mobile: barra de abas inferior e "Mais"

- **Decisão:**
  - Novo `components/layout/MobileTabBar.tsx`, exibido abaixo de `md` (768px).
  - Abas Vagas, Minhas vagas (com contador), Perfil e Mais. Altura 64px + `env(safe-area-inset-bottom)`.
  - "Mais" abre um sheet com Configurações de IA, Dados e backup, Fontes, Guia de início, Apoie, Privacidade e Tema (Claro/Escuro/Sistema).
  - Abaixo de `md`, o header fica com 56px (logo + tema); o rodapé e o nav do topo usam `hidden md:flex`.
  - O `<main>` ganha `pb-[calc(72px+env(safe-area-inset-bottom))]`, e toasts e "Desfazer" sobem para cima da barra.
  - **Restrição de CSP:** o array `NAV` e o `NavLink` saem de `SiteHeader.tsx` para `components/layout/nav.ts`, reaproveitados pela barra. As rotas `(local)` continuam com `HardLink`, porque `next/link` faria navegação no cliente sem o nonce da CSP (`hard-link.tsx:9-12`).
  - Telas de "push" (detalhe da vaga, gerador) **trocam** a barra de abas pela sua barra de ação, com voltar no header.
  - Em `app/layout.tsx` entra `export const viewport = { viewportFit: "cover", themeColor }`.
- **Alternativa descartada:** menu hambúrguer. Foi recusado pelo usuário: esconde as seções e é ruim para uso com uma mão.
- **Consequências:**
  - São 3 pontos de montagem: `(site)/page.tsx`, `vagas/[id]/page.tsx` e `(local)/layout.tsx`. O melhor é criar um `AppShell`.
  - O E2E ganha projetos mobile. *(base: mobile)*

### D-07 Pré-visualização do PDF no celular

- **Contexto:** o `<iframe blob:>` não renderiza PDF no Chrome Android, e o iOS mostra só a 1ª página.
- **Opções:**
  - (a) Usar o `pdfjs` que já está no bundle, carregado sob demanda para importar o currículo, para desenhar as páginas em `<canvas>`.
  - (b) Miniatura + "Abrir PDF em tela cheia" (nova aba).
  - (c) Manter o iframe.
- **Decisão:** **(a) se o worker do pdfjs já estiver liberado na CSP**; senão, (b) primeiro e (a) depois.
- **Verificado:** a CSP já libera `worker-src 'self' blob:` (`lib/shared/csp.ts:19`), e o `unpdf/pdfjs` já é importado sob demanda em `lib/client/extract/extract-core.ts:53`. Fica valendo a opção (a); a (b) vira o fallback quando o pdfjs falha.
- **Consequências:** `PdfPreview.tsx` ganha um modo canvas, e o gerador no celular ganha abas Editar/Pré-visualizar e uma barra "Gerar de novo · Baixar PDF". *(base: mobile e auditoria técnica)*

### D-08 Detalhe da vaga

- **Decisão:**
  - **Desktop:**
    - Conteúdo à esquerda, com a descrição limitada a 70ch e parágrafos normalizados.
    - Coluna direita sticky com: "Candidatar-se na <fonte> ↗" (primário, uma linha só); Salvar + Status; Gerar CV; Ocultar (link).
    - Abaixo, o card **"Sua aderência"**, que junta "Sua chance" e "Análise com IA" num CTA só.
  - **Celular:**
    - Resumo de aderência logo abaixo do título.
    - Abas "Sobre a vaga | Análise com IA".
    - Barra fixa "☆ · Gerar CV · Candidatar-se".
- **Consequências:**
  - `JobDetail.tsx` e `AiAnalysis.tsx` mudam.
  - A normalização de parágrafos acontece na renderização (`render-html.ts`), não na ingestão. *(base: crítica UX e mobile)*

### D-09 Minhas vagas como funil

- **Decisão:**
  - Quatro etapas: Salvas → Aplicadas → Entrevista → Proposta.
  - "Favoritas" vira filtro ("Só favoritas") e as ocultas, link secundário.
  - **Desktop:** 4 colunas com contador e mini-card (chance, "CV gerado", ⋯).
  - **Celular:** seletor segmentado com contadores e cards com o botão "Mover ▾".
  - Estado vazio com CTA.
  - O que acontece com "Recusada/Encerrada" é pergunta em aberto (P-02).
- **Alternativa descartada:** kanban com arrastar no celular. Não é acessível e brigaria com a rolagem.
- **Consequências:**
  - Só a UI de `Board.tsx` e `Column.tsx` muda; o `jobStateStore` continua igual.
  - A tela não reutiliza os filtros da home. *(base: crítica UX e mobile)*

### D-10 Configurações e Fontes

- **Configurações:**
  - Status no topo e OpenRouter em destaque, com o único CTA primário.
  - Os outros provedores em lista (no celular, linhas de 56px que abrem um sheet).
  - "Modelo por tarefa" só aparece depois de conectar um provedor.
  - "Dados e backup" vira seção própria.
  - A página passa a se chamar "Configurações".
  - No celular, os diálogos viram sheet em tela cheia, com o campo no topo (o teclado não cobre).
- **Fontes:** um banner global quando todas as fontes estão atrasadas, e um ponto de status por fonte.
- **Consequências:** `AiSettingsScreen.tsx`, `ProviderCard.tsx`, `ModelPickerDialog.tsx`, `AddKeyDialog.tsx` e `SourcesPage.tsx`. *(base: crítica UX e mobile)*

### D-11 Varredura de acessibilidade

- `min-h-11` nos alvos citados na seção 2: footer, `StackChips`, "Limpar" e fechar do diálogo (`size-11`).
- `motion-reduce:animate-none` num `Skeleton` compartilhado.
- Link "Pular para o conteúdo".
- `text-wrap: balance` nos títulos de h1 a h3.
- `hover:` dentro de `@media (hover: hover)`.
- h1 do Perfil com `font-display`.

*(base: auditoria técnica)*

### Eixos sem impacto

- **Dados, migrações, APIs, integrações externas:** nada muda. O estado continua no `localStorage` com os stores atuais. O único parâmetro novo, `?voltar`, é só de cliente e validado (D-03).
- **Performance:** é neutra. O pdfjs já é carregado sob demanda (D-07), e a tab bar e os sheets são leves.
- **Segurança:** a CSP é preservada (D-06, D-07) e o `?voltar` é validado contra open redirect (D-03).

## 4. Plano de entrega em fases

| Fase | Entrega | Tarefas (esforço) | Depende de |
|---|---|---|---|
| **1. Fundação** (menor corte, reduz o maior risco) | Tokens unificados, contraste AA, viewport/safe-area, primitivo Sheet | D-01 tokens + teste de paleta (P); `viewport` e safe-area (P); `components/ui/sheet.tsx` sobre `@base-ui/react/dialog` com testes de a11y (M); D-11 varredura (P) | — |
| **2. Navegação mobile** | Tab bar, "Mais", header compacto, toasts acima da barra | `nav.ts` compartilhado + `MobileTabBar` + `MoreSheet` + `AppShell` (M); toasts (P); projetos Playwright iPhone 13 e Pixel 7 (M) | Fase 1 |
| **3. Lista de vagas** | Topo compacto, filtros em sheet, card com uma ação, checklist de setup | D-04 (M); D-05 (M); D-03 `SetupProgress` + `?voltar` (M) | Fases 1 e 2 |
| **4. Vaga e gerador** | Detalhe com barra de ação e "Sua aderência"; gerador mobile | D-08 (M); D-07 (G) | Fase 3 (`SetupProgress`) |
| **5. Minhas vagas, Configurações, Perfil, Fontes** | Funil, configurações em lista, textos de toque | D-09 (M); D-10 (M); Perfil (P); Fontes e Apoie (P) | Fases 1 e 2 |
| **6. Botões unificados** | `cva` como fonte única | D-02, incremental (M) | Fase 1 |

- **Caminho crítico:** fases 1 → 2 → 3 → 4.
- **Paralelizáveis:** as fases 5 e 6 podem rodar ao lado da fase 3, porque tocam arquivos diferentes.

**Pronto quando:**
- `pnpm typecheck && pnpm lint && pnpm test` passam.
- O E2E desktop e os novos projetos mobile passam.
- O contraste é verificado pelo teste de paleta.
- RF-01 tem uma asserção de posição do 1º card no Playwright, em 1440×900 e 390×844.

## 5. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| A tab bar com `next/link` quebra a CSP de nonce nas rotas `(local)` | Média | Alto | `nav.ts` único com a regra Link/HardLink e um teste E2E que navega da aba até /perfil e checa ausência de erro de CSP |
| O mapeamento shadcn→jf muda o visual de diálogos e botões existentes | Alta | Baixo | É a intenção. Revisar as capturas antes e depois (`docs/design/auditoria-2026-11-24/`) |
| O `?voltar` vira open redirect | Baixa | Médio | Allowlist de prefixos internos e teste unitário |
| O worker do pdfjs exige mudar a CSP | Média | Médio | Fallback (b) do D-07 |
| E2E existentes quebram com o menu "⋯" | Alta | Baixo | Atualizar seletores na mesma fase |
| As capturas foram feitas em Chromium emulado | — | Médio | Validar em iOS Safari e num Android de entrada antes de fechar a fase 2 |

## 6. Premissas e perguntas em aberto

**Premissas**
- Não há PRD específico para este redesign; os requisitos da seção 1 vêm da conversa e da auditoria.
- A barra de ação da vaga e do gerador **substitui** a tab bar, que é o padrão de tela de "push".
- O botão de tema vai para "Mais" no celular e continua no header no desktop.

**Perguntas em aberto**
- **P-01.** A chance pode ter uma versão sem IA, a partir de stack e senioridade preenchidas à mão? Isso daria valor antes de a pessoa trazer a própria chave. Muda o D-03.
- **P-02.** No funil de Minhas vagas, onde ficam as vagas recusadas ou encerradas: numa coluna "Arquivadas" ou num filtro?
- **P-03.** "Favoritas" e o status "Salva" devem virar um só conceito?
- **P-04.** O aviso de coleta parada é para quem usa o site ou para quem mantém o projeto? Se for para quem mantém, sai da home.
- **P-05.** "Apoie" sai do nav principal do desktop e vai para o rodapé ou para o "Mais"? O design já o tirou do nav principal no desktop.
