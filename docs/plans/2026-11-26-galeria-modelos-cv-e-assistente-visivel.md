# Galeria de modelos de CV com prévia A4 e assistente de IA visível — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use `superpowers:subagent-driven-development` (recomendado) ou `superpowers:executing-plans` para executar tarefa a tarefa. Os passos usam checkbox (`- [ ]`).

**Objetivo:** escolher o modelo do CV vendo uma prévia visual real (folhas A4 pequenas + prévia grande) no perfil e no gerador, com o card de modelos abaixo do "Importar currículo", e deixar o assistente de IA do perfil fácil de achar.

**Arquitetura:** a prévia é renderizada no navegador com os dados do usuário: `renderCvPdf` gera o PDF e o pdf.js (`unpdf/pdfjs`, já usado em `PdfPreview`) desenha a página 1 em PNG, com fila sequencial e cache em memória. O `TemplatePicker` vira uma galeria em modal grande, com a mesma API mais a prop `cv`. O assistente ganha um card de atalhos no topo do editor e botões com ícone.

**Stack:** Next 16, React 19, Tailwind 4, Base UI `Dialog`, `@react-pdf/renderer`, `unpdf/pdfjs`, `lucide-react`, Vitest + Testing Library (jsdom), Playwright.

**Spec:** [docs/tech/2026-11-26-galeria-modelos-cv-e-assistente-visivel.md](../tech/2026-11-26-galeria-modelos-cv-e-assistente-visivel.md)

## Restrições globais

- Nenhuma dependência nova, nenhuma variável de ambiente nem feature flag; tudo já ativo.
- Textos visíveis em pt-BR com acentuação correta.
- Nome acessível do gatilho do seletor continua exatamente `Modelo do CV: <nome do modelo>` (usado em `tests/e2e/generator.spec.ts` e `tests/unit/client/template-picker.test.tsx`).
- O seletor mantém o `radiogroup` com `<input type="radio">`; trocar o radio não chama `onChange`, só "Usar este modelo".
- Nada sai do navegador: a prévia usa só `renderCvPdf` local.
- Miniatura: proporção A4 `aspect-[210/297]`; cache com no máximo 20 entradas; uma renderização por vez.
- Alvos de toque ≥ 44 px (`min-h-11`), como no resto do app.
- Verificação de cada tarefa: `pnpm typecheck && pnpm lint && pnpm test`; E2E dos arquivos tocados com `pnpm test:e2e <arquivo>`.

## Foco de revisão

1. **Abrir e fechar o modal rápido várias vezes:** renderizações antigas são canceladas/ignoradas e nenhuma miniatura de um CV anterior aparece no lugar da atual (teste em Tarefa 2: chave do cache inclui o hash do CV).
2. **Falha ao renderizar um modelo:** a miniatura mostra "Prévia indisponível" e o modelo continua selecionável (teste em Tarefa 3).
3. **Perfil editado e não salvo no perfil:** a prévia usa o perfil **salvo**, como o "Baixar CV base" (teste em Tarefa 4).
4. **Gerador ainda sem CV gerado:** a prévia cai para `assembleBaseCv(profile, lang)` em vez de quebrar (teste em Tarefa 5).
5. **Experiências todas fechadas:** o atalho "Experiências" do card do assistente abre a primeira experiência e o assistente dela; sem experiência, o atalho fica desabilitado com o motivo (teste em Tarefa 1).

---

### Task 1: Assistente de IA visível (independente das demais)

**Arquivos:**
- Criar: `components/profile/assistant/AssistantHub.tsx`
- Modificar: `components/profile/assistant/AssistButton.tsx`, `components/profile/ProfileEditor.tsx` (perto das linhas 95-206), `components/profile/ExperienceEditor.tsx` (linha ~160 e linha de botões ~164)
- Teste: `tests/unit/client/assistant-hub.test.tsx`, `tests/unit/client/profile-editors.test.tsx`, `tests/e2e/profile-assistant.spec.ts`

**Interfaces:**
- Produz: `AssistantHub({ headlineEmpty: boolean; summaryEmpty: boolean; firstExpId: string | null; onField: (f: "headline" | "summary") => void; onExperience: (expId: string) => void })`.
- `AssistButton` mantém a assinatura `{ empty, onClick }`; ganha o ícone `Sparkles` (`aria-hidden`) e prop opcional `label?: string` para o nome acessível com contexto (ex.: "Melhorar com IA: Título profissional").

- [ ] **Passo 1: testes que falham** em `assistant-hub.test.tsx`:
  - `"mostra os três atalhos com Escrever/Melhorar conforme o campo"`: com `headlineEmpty=true, summaryEmpty=false` existem os botões `"Escrever o título com IA"`, `"Melhorar o resumo com IA"`, `"Melhorar experiências com IA"`.
  - `"clicar em Título chama onField('headline')"` e o mesmo para resumo.
  - `"com firstExpId null, o atalho de experiências fica desabilitado e explica"`: botão `disabled` e texto `"Adicione uma experiência para usar o assistente nela."`.
  - Em `profile-editors.test.tsx`: `"o atalho de experiências abre a experiência fechada e o assistente dela"` — renderiza `ProfileEditor` com uma experiência, clica no atalho, espera `findByRole("dialog")`.
  - Em `profile-editors.test.tsx`: `"experiência fechada já mostra Melhorar com IA"`.
- [ ] **Passo 2:** `pnpm vitest run tests/unit/client/assistant-hub.test.tsx tests/unit/client/profile-editors.test.tsx` → FALHA (módulo inexistente / botão ausente).
- [ ] **Passo 3: implementar.**
  - `AssistantHub`: `section` com `aria-labelledby`, título "Assistente de IA", texto "A IA pode escrever ou melhorar seus textos a partir do que você já tem." e os três botões em estilo de destaque (`BTN_PRIMARY` em tamanho menor ou o token de marca do design system, com `Sparkles`).
  - `ProfileEditor`: renderizar o hub logo depois de `<ProfileReview …/>`; `onField` → `setAssist({ field, open: true })`; `onExperience` → `setBulletFix((b) => ({ expId, n: (b?.n ?? 0) + 1 }))` (mesmo mecanismo do "Corrigir"). `firstExpId = draft.experiences[0]?.id ?? null` (conferir o nome do campo em `lib/shared/schemas/profile.ts`).
  - `AssistButton` de Título e Resumo vai para a linha do rótulo (rótulo à esquerda, botão à direita, `flex items-center justify-between`).
  - `ExperienceEditor`: na linha de botões "Editar experiência" (fora do bloco `open`), adicionar `AssistButton` que chama `onAssist`; confirmar que `assistRequest` já abre a experiência fechada — se não abrir, `setOpen(true)` no efeito que trata `assistRequest`.
- [ ] **Passo 4:** rodar os testes do passo 2 → PASSA. Atualizar `tests/e2e/profile-assistant.spec.ts` se algum seletor mudou de lugar e rodar `pnpm test:e2e tests/e2e/profile-assistant.spec.ts` → PASSA.
- [ ] **Passo 5: commit** `feat(perfil): atalhos e destaque do assistente de IA`.

### Task 2: Miniatura do CV (renderização, fila e cache)

**Arquivos:**
- Criar: `lib/client/pdf/draw-page.ts`, `lib/client/pdf/thumbnail.ts`
- Modificar: `components/generator/PdfPreview.tsx:25-60` (usar `drawPdfPage`)
- Teste: `tests/unit/client/cv-thumbnail.test.ts`

**Interfaces:**
- Produz:
  - `drawPdfPage(page: PDFPageProxy, canvas: HTMLCanvasElement, cssWidth: number): { promise: Promise<void>; cancel: () => void }` — escala por `devicePixelRatio`.
  - `renderCvThumbnail(cv: AssembledCv, templateId: CvTemplateId, widthPx: number): Promise<string>` — devolve object URL de PNG da página 1; usa a fila e o cache.
  - `thumbnailKey(cv: AssembledCv, templateId: CvTemplateId, widthPx: number): string` — `templateId:widthPx:hash(JSON.stringify(cv))` (hash FNV-1a de 32 bits, sem dependência).
  - `__resetThumbnailCache(): void` (só para testes).

- [ ] **Passo 1: testes que falham** (mockar `@/lib/client/pdf/render` e `unpdf/pdfjs` com `vi.mock`; `URL.createObjectURL` com `vi.fn`):
  - `"mesma chave reaproveita o cache e não renderiza de novo"`: duas chamadas iguais → `renderCvPdf` chamado 1 vez, mesmo URL.
  - `"CV diferente gera chave diferente"`: `thumbnailKey` muda quando muda `cv.name`.
  - `"renderiza uma por vez"`: três chamadas simultâneas com modelos diferentes; o mock de `renderCvPdf` registra concorrência máxima = 1.
  - `"o cache guarda no máximo 20 e revoga o URL do mais antigo"`: 21 modelos/larguras distintos → `URL.revokeObjectURL` chamado 1 vez com o primeiro URL.
  - `"falha na renderização rejeita e não fica no cache"`: mock lança na 1ª e resolve na 2ª → 2ª chamada renderiza de novo.
- [ ] **Passo 2:** `pnpm vitest run tests/unit/client/cv-thumbnail.test.ts` → FALHA.
- [ ] **Passo 3: implementar.** Fila = promessa encadeada (`let tail = Promise.resolve()`); cache = `Map` com ordem de inserção como LRU. A renderização: `renderCvPdf` → `getDocument({ data, useWasm: false, useSystemFonts: true })` (mesmas opções de `extract-core.ts:53`) → `getPage(1)` → `drawPdfPage` num `document.createElement("canvas")` → `canvas.toBlob("image/png")` → `task.destroy()`. Refatorar `PageCanvases` em `PdfPreview` para usar `drawPdfPage` sem mudar o comportamento.
- [ ] **Passo 4:** `pnpm vitest run tests/unit/client/cv-thumbnail.test.ts tests/unit/client/pdf*.test.*` → PASSA; `pnpm typecheck`.
- [ ] **Passo 5: commit** `feat(cv): miniatura do CV renderizada no navegador`.

### Task 3: Galeria no `TemplatePicker`

**Arquivos:**
- Criar: `components/generator/CvThumbnail.tsx`
- Modificar: `components/generator/TemplatePicker.tsx`
- Teste: `tests/unit/client/template-picker.test.tsx`

**Interfaces:**
- Consome: `renderCvThumbnail` (Tarefa 2), `PdfPreview` com `mode="canvas"` (já existe).
- Produz:
  - `CvThumbnail({ cv: AssembledCv; templateId: CvTemplateId; width: number; className?: string })` — `<img>` A4 com `alt=""` (o nome vem do label), skeleton enquanto carrega, "Prévia indisponível" se falhar; só renderiza quando visível (`IntersectionObserver`; sem ele, renderiza direto).
  - `TemplatePickerProps` ganha `cv: AssembledCv` (obrigatória).

- [ ] **Passo 1: testes que falham** (mockar `@/lib/client/pdf/thumbnail` resolvendo `"blob:x"` e `PdfPreview` com um stub `data-testid="preview-grande"`):
  - Atualizar `open()` para passar `cv` de um fixture (`assembleBaseCv` sobre o perfil de fixture já usado nos testes de CV).
  - `"o gatilho mostra a miniatura do modelo atual e mantém o nome acessível"`: botão `"Modelo do CV: Clássico"` contém um `img`.
  - `"cada um dos 10 modelos tem uma miniatura A4"`: dentro do radiogroup, 10 `img`.
  - `"a prévia grande acompanha o modelo selecionado"`: clicar no radio Harvard → o stub recebe `templateId="harvard"` e aparece o texto da descrição do Harvard na área da prévia.
  - `"miniatura que falha mostra Prévia indisponível e o modelo continua selecionável"`.
  - Os testes existentes (10 radios, recomendado, setas não confirmam, "Usar este modelo", caixa de padrão) continuam passando.
- [ ] **Passo 2:** `pnpm vitest run tests/unit/client/template-picker.test.tsx` → FALHA.
- [ ] **Passo 3: implementar** conforme a D-02 da spec: `DialogContent mobile="sheet" className="sm:max-w-6xl sm:h-[88vh]"`; corpo `grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]`; à esquerda a grade de labels (`grid grid-cols-2 lg:grid-cols-3`), cada label com o radio visualmente discreto, `CvThumbnail width={150}`, nome e selo "Recomendado para você"; à direita nome, descrição, "Indicado para" e `<PdfPreview cv={cv} templateId={selected} letter={null} mode="canvas" />` com rolagem própria; rodapé fixo com a caixa de padrão e "Usar este modelo". O gatilho: `aria-label={`Modelo do CV: ${current.name}`}`, miniatura de 56 px + "Modelo: <nome> · Trocar".
- [ ] **Passo 4:** `pnpm vitest run tests/unit/client/template-picker.test.tsx` → PASSA; `pnpm typecheck` vai acusar os dois usos sem `cv` (resolvidos nas Tarefas 4 e 5, que podem ir no mesmo commit se preferir manter o build verde).
- [ ] **Passo 5: commit** `feat(cv): galeria de modelos com prévia A4`.

### Task 4: Card de modelos abaixo do "Importar currículo"

**Arquivos:**
- Modificar: `components/profile/ProfileScreen.tsx:79-100`, `components/profile/BaseCvDownload.tsx`
- Teste: `tests/unit/client/profile-editors.test.tsx` (ou o teste existente do `ProfileScreen`, se houver), `tests/e2e/profile.spec.ts`

**Interfaces:**
- Consome: `TemplatePicker` com `cv` (Tarefa 3).

- [ ] **Passo 1: testes que falham:**
  - `"o card Modelos de CV vem depois do Importar currículo, na mesma coluna"`: na ordem do DOM, o heading "Modelos de CV" vem depois do heading do `ImportPanel` e antes do editor.
  - `"a prévia usa o perfil salvo e o idioma escolhido"`: trocar o idioma para English → o `cv` passado ao `TemplatePicker` (mock) tem os rótulos em inglês.
- [ ] **Passo 2:** rodar → FALHA.
- [ ] **Passo 3: implementar.** Mover `{profile && <BaseCvDownload profile={profile} />}` para a coluna esquerda, depois de `<ImportPanel …/>` (com `mt-6`); no `BaseCvDownload`, `const cv = useMemo(() => assembleBaseCv(profile, lang), [profile, lang])`, passar `cv` ao picker e reaproveitar no download; layout empilhado (gatilho, idioma, botão em coluna) e sem `mb-6`.
- [ ] **Passo 4:** testes → PASSA; `pnpm test:e2e tests/e2e/profile.spec.ts` → PASSA.
- [ ] **Passo 5: commit** `feat(perfil): modelos de CV abaixo da importação`.

### Task 5: Galeria no gerador

**Arquivos:**
- Modificar: `components/generator/GeneratorToolbar.tsx` (prop nova `previewCv: AssembledCv`), `components/generator/GeneratorScreen.tsx` (perto da linha 367 e do `<GeneratorToolbar`, ~439)
- Teste: `tests/e2e/generator.spec.ts` (blocos das linhas 630-700)

**Interfaces:**
- Consome: `TemplatePicker` com `cv` (Tarefa 3).
- `previewCv = review?.cv ?? assembleBaseCv(profile, lang)` (com `useMemo`); se não houver perfil, o toolbar não renderiza o picker (o gerador já bloqueia sem perfil).

- [ ] **Passo 1: teste que falha** em `generator.spec.ts`: `"o seletor do gerador mostra 10 miniaturas A4 e a prévia grande"` — abrir `Modelo do CV:`, esperar 10 `img` dentro do radiogroup (carregadas, `naturalWidth > 0` nas visíveis) e um `canvas` na área da prévia.
- [ ] **Passo 2:** `pnpm test:e2e tests/e2e/generator.spec.ts` → FALHA.
- [ ] **Passo 3: implementar** a prop e o `useMemo`.
- [ ] **Passo 4:** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e tests/e2e/generator.spec.ts tests/e2e/profile.spec.ts tests/e2e/profile-assistant.spec.ts` → tudo PASSA; `pnpm build` → sucesso.
- [ ] **Passo 5: conferência visual** no navegador (`/perfil` e o gerador), desktop e 375 px: card abaixo da importação, modal grande com folhas A4 e prévia, assistente visível no topo do editor. Medir o tempo até as miniaturas visíveis aparecerem (meta informal: a tela não congela; se congelar, registrar o R-01 da spec para a fase do Web Worker).
- [ ] **Passo 6: commit** `feat(gerador): galeria de modelos com prévia no gerador`.

## Ordem e paralelismo

- **Tarefa 1** é independente: pode rodar em paralelo com 2.
- **2 → 3 → (4 e 5)**: 4 e 5 dependem de 3 e não tocam os mesmos arquivos, então podem rodar em paralelo entre si.
- Atualizar o RF-38 no PRD como "atendido pela galeria renderizada no navegador (spec 2026-11-26)" no commit da Tarefa 5.
