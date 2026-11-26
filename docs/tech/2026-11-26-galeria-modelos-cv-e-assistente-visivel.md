# Spec técnica: galeria de modelos de CV com prévia A4 e assistente de IA visível

- **Data:** 2026-11-26
- **Origem:** pedido do usuário na conversa (sem PRD novo). Retoma o RF-38 do [PRD 2026-11-25](../prd/2026-11-25-glassdoor-filtros-ia-perfil-templates-cv.md) (miniaturas dos templates), adiado em [D-10 da Fase 2](./2026-11-25-fase2-templates-cv.md), e a descoberta do assistente da [Fase 3](./2026-11-25-fase3-assistente-ia-perfil.md).
- **Requisitos (premissas, registradas a partir do pedido):**
  - **P-01.** No perfil, o card de modelos de CV fica **abaixo** do card "Importar currículo".
  - **P-02.** Ao escolher um modelo (perfil e gerador), abre um **modal grande** que mostra uma **prévia visual** do CV em cada modelo, não só o texto.
  - **P-03.** No gerador, a escolha mostra cada modelo como uma **folha A4 pequena**.
  - **P-04.** O assistente de IA do perfil (escrever e melhorar textos) precisa ser **fácil de achar**.
- **Tamanho:** pequeno a médio, só front-end. Não há rota, tabela, migração nem dependência nova.
- **Especialistas:** não houve convocação em paralelo. Tudo reaproveita módulos de cliente que já existem (`renderCvPdf`, o pdf.js do `unpdf` já usado em `PdfPreview`, o `Dialog` do Base UI e o `AssistantDialog`). Não há superfície nova de segurança: os dados não saem do navegador.

## 1. Como o código está hoje (fatos)

- **Card de modelos no perfil.** `components/profile/BaseCvDownload.tsx` ("Modelos de CV") fica na **coluna da direita**, acima do editor (`components/profile/ProfileScreen.tsx:94`). O "Importar currículo" (`ImportPanel`) fica na coluna da esquerda (`ProfileScreen.tsx:81`). O card só aparece quando há perfil salvo.
- **Seletor de modelo.** `components/generator/TemplatePicker.tsx` é um botão "Modelo do CV: <nome>" que abre um `Dialog` `sm:max-w-lg` com um `radiogroup` de 10 itens **só de texto** (nome, descrição, "Indicado para"). É usado no perfil (`BaseCvDownload.tsx:70`) e no gerador (`GeneratorToolbar.tsx:55`).
- **Prévia de PDF já existe no gerador.** `components/generator/PdfPreview.tsx` renderiza o PDF com `renderCvPdf` (debounce de 500 ms) e o desenha em `<canvas>` com o pdf.js de `unpdf/pdfjs` (`PageCanvases`, linhas 25-60), ou em `<iframe>` a partir de `lg`. Ou seja, **rasterizar PDF no navegador já é feito**, sem dependência nativa. O D-10 da Fase 2 adiou as miniaturas porque pensava em gerar PNG em node (canvas nativo); no navegador esse custo não existe.
- **Dados para a prévia.** Perfil: `assembleBaseCv(profile, lang)` (`lib/client/cv/assemble.ts`). Gerador: `review.cv` (CV adaptado à vaga), usado em `GeneratorScreen.tsx:389`.
- **Assistente de IA do perfil: existe e está na `main`** (PR #31, Fase 3). Os botões `AssistButton` ("Escrever com IA" se o campo está vazio, "Melhorar com IA" se preenchido) estão:
  - abaixo do campo **Título profissional** (`ProfileEditor.tsx:114`);
  - abaixo do **Resumo** (`ProfileEditor.tsx:187`);
  - dentro de cada **experiência**, mas só depois de clicar em "Editar experiência", ao lado de "+ Realização" (`ExperienceEditor.tsx:160`).
  - O "Corrigir" da revisão do perfil (`ProfileReview`) também abre o assistente.
- **Por que você não está vendo (diagnóstico):** o editor (e com ele os botões) **só aparece quando já existe perfil** ou depois de "Preencher manualmente" (`ProfileScreen.tsx:96`). E, quando aparece, os botões são contornados, sem ícone, abaixo dos campos, e o das experiências fica escondido dentro da edição. Não há nenhum ponto no topo da tela que anuncie o assistente. Se você olhou em produção, vale confirmar se o deploy da `main` depois do PR #31 subiu (pergunta Q-01).
- **Testes que citam o seletor:** `tests/unit/client/template-picker.test.tsx`, `tests/unit/client/profile-editors.test.tsx`, `tests/e2e/generator.spec.ts`.

## 2. Decisões

### D-01. Prévia renderizada no navegador com os dados reais, sem PNG estático (P-02, P-03, RF-38)

- **Contexto.** O pedido é ver o CV antes de escolher. O RF-38 previa PNGs estáticos gerados por script com perfil fictício.
- **Opções.**
  1. **PNG estático por script** (RF-38 original): abre na hora, mas pede canvas nativo em node (dependência pesada), mostra dados fictícios e precisa ser regerado a cada mudança de template.
  2. **Renderizar no navegador com os dados do usuário** (escolhida): `renderCvPdf` + pdf.js desenhando a página 1 num canvas pequeno. Sem dependência nova, sempre igual ao PDF final, mostra o CV **da pessoa**.
  3. Prévia em HTML/CSS imitando cada template: rápida, mas duplica os 10 layouts e diverge do PDF. Descartada.
- **Decisão.** Opção 2. Novo módulo `lib/client/pdf/thumbnail.ts` com `renderCvThumbnail(cv, templateId, widthPx): Promise<Blob>` (PNG da página 1 via `canvas.toBlob`), extraindo de `PdfPreview` o trecho de desenho do pdf.js para uma função comum (`drawPdfPage`), reaproveitada pelos dois.
- **Consequências.** Fila **sequencial** (uma renderização por vez, com `await` entre elas para não travar a tela), **sob demanda** (só miniaturas visíveis, via `IntersectionObserver`) e **cache em memória** (`Map` por `templateId + hash do CV + idioma`, com no máximo 20 entradas e `URL.revokeObjectURL` ao descartar). Substitui o RF-38: o PRD passa a ter o requisito atendido por outro caminho.

### D-02. Modal grande compartilhado: `TemplateGallery` (P-02, P-03)

- **Contexto.** O mesmo seletor serve ao perfil e ao gerador; os dois pedidos são iguais.
- **Decisão.** Reescrever o conteúdo do `TemplatePicker` (mesma API de props, mais `cv: AssembledCv` para a prévia) como uma galeria:
  - **Desktop (`sm` em diante):** `DialogContent` com `sm:max-w-6xl h-[88vh]`, duas áreas. À esquerda, grade de **folhas A4 pequenas** (`aspect-[210/297]`, ~150 px de largura, 2 a 3 colunas) com nome e o selo "Recomendado para você". À direita, a **prévia grande** do modelo selecionado, rolável e com todas as páginas (reaproveita `PdfPreview` em `mode="canvas"`), com descrição e "Indicado para" acima.
  - **Celular:** `mobile="sheet"`, grade de miniaturas em 2 colunas; tocar numa miniatura seleciona e mostra a prévia grande embaixo.
  - O `radiogroup` com `<input type="radio">` continua (acessibilidade e testes); a miniatura vira o conteúdo visual do `label`, com `alt`/`aria-describedby` do nome e da descrição.
  - Botão "Usar este modelo" e a caixa "Usar como padrão nos próximos CVs" (só no gerador) ficam fixos no rodapé do modal.
- **Gatilho.** O botão deixa de ser só texto: mostra a **miniatura A4 do modelo atual** + "Modelo: <nome> · Trocar". No gerador, o mesmo gatilho na barra de opções (P-03).
- **Fonte dos dados da prévia.** Perfil: `assembleBaseCv(profile, lang)` com o idioma escolhido no card. Gerador: `review.cv` quando já há CV gerado; senão `assembleBaseCv(profile, lang)`.

### D-03. Card de modelos abaixo do "Importar currículo" (P-01)

- Mover `<BaseCvDownload>` da coluna direita para a coluna esquerda, logo abaixo do `ImportPanel` (`ProfileScreen.tsx`). Continua aparecendo só com perfil salvo (sem perfil não há o que prever nem baixar).
- Ajustar o card à largura da coluna (`lg:max-w-[420px]`): gatilho com a miniatura em cima, idioma e "Baixar CV base" empilhados.
- A âncora `#modelos-de-cv` continua, porque outros pontos podem linkar para ela.

### D-04. Assistente de IA visível (P-04)

- **Contexto.** O assistente funciona; o problema é descoberta (ver seção 1).
- **Opções.**
  1. Só dar ícone ✨ e cor de destaque aos botões existentes: barato, mas continua escondido nas experiências.
  2. **Card "Assistente de IA" no topo do editor + botões destacados** (escolhida).
  3. Assistente em painel lateral fixo: muda a estrutura da tela, caro para o ganho.
- **Decisão.**
  - Novo `components/profile/assistant/AssistantHub.tsx`, logo abaixo da revisão do perfil e antes dos campos: texto curto ("A IA pode escrever ou melhorar seus textos a partir do que você já tem") e três ações — **Título**, **Resumo** e **Experiências** (esta abre a primeira experiência em edição e o assistente dela, reaproveitando o mecanismo `bulletFix` que já existe em `ProfileEditor.tsx`). Cada ação mostra "Escrever" ou "Melhorar" conforme o campo.
  - `AssistButton` ganha o ícone `Sparkles` do `lucide-react` (já é dependência) e o estilo de destaque do design system, e passa para a **linha do rótulo** do campo, em vez de abaixo dele.
  - Nas experiências, o botão "Melhorar com IA" passa a aparecer também **com a experiência fechada**, ao lado de "Editar experiência".
  - Sem provedor de IA configurado, os botões continuam visíveis e o diálogo já mostra o `NoProviderCta` (`AssistantDialog.tsx:70`).
  - Sem perfil, o "Preencher manualmente" e a importação já levam ao editor; o card do topo da tela ganha uma linha citando o assistente.

### Eixos sem impacto

Dados/migrações, APIs e contratos, integrações externas, segurança (tudo local; nenhum dado sai do navegador) e operação: sem mudança.

## 3. Riscos

| Risco | Prob./Impacto | Mitigação |
|---|---|---|
| R-01. Renderizar 10 PDFs com `@react-pdf` trava a tela (roda na thread principal) | Média / Médio | Fila sequencial, só as visíveis, cache, skeleton por miniatura; a prévia grande tem prioridade sobre as miniaturas. Se ainda travar, mover a renderização para um Web Worker numa fase seguinte. |
| R-02. Celular com pouca memória ao manter 10 canvases | Baixa / Médio | Guardar PNG (Blob + object URL) e não o canvas; limitar o cache. |
| R-03. Testes que procuram o texto "Modelo do CV:" quebram | Alta / Baixo | Manter o nome acessível do gatilho ("Modelo do CV: <nome>") e atualizar os três arquivos de teste. |
| R-04. jsdom não tem canvas/pdf.js | Alta / Baixo | Nos testes unitários, mockar `renderCvThumbnail`; a renderização real fica no E2E. |

## 4. Plano de entrega

| Fase | Entrega | Esforço |
|---|---|---|
| 1 | **Assistente visível (D-04):** `AssistantHub`, ícone e posição do `AssistButton`, botão nas experiências fechadas; testes unitários e E2E `profile-assistant.spec.ts` atualizados. | P |
| 2 | **Miniaturas (D-01):** `drawPdfPage` extraído de `PdfPreview`, `renderCvThumbnail`, fila e cache, com testes unitários da fila/cache. | M |
| 3 | **Galeria (D-02, D-03):** novo `TemplatePicker` com grade A4 + prévia grande, gatilho com miniatura, card movido no perfil, prop `cv` no gerador; testes de `template-picker`, `profile-editors` e `generator.spec.ts`. | M |

Caminho crítico: fase 2 → fase 3. A fase 1 é independente e pode rodar em paralelo.

Verificação de cada fase: `pnpm typecheck && pnpm lint && pnpm test`, E2E dos arquivos tocados e conferência visual no navegador (desktop e 375 px).

## 5. Perguntas em aberto

- **Q-01 (respondida em 2026-11-26).** Procurou em produção, com perfil salvo. O deploy de produção na Vercel está no commit `5d582aa` (PR #33, estado READY), que já inclui o PR #31. Logo, o assistente está em produção e o problema é de **descoberta**, o que confirma a D-04.
- **Q-02.** Sem perfil salvo, o card de modelos deve aparecer mesmo assim, com um CV de exemplo fictício? A premissa desta spec é **não** (só com perfil).
