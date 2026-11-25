# Fase 3 — Assistente de IA no perfil: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar "Escrever com IA" (entrevista) e "Melhorar com IA" (reescrita) no editor de perfil, com validador anti-invenção, revisão determinística do perfil e sugestão de skills.

**Architecture:** Três `PromptDef` novos chamados via `generateStructured` (modelo da tarefa `cv`, BYOK, no navegador). Um validador de texto livre reaproveita os detectores de `lib/client/cv/validate.ts`. A UI é um `Dialog` (sheet no celular) que só altera o rascunho do `ProfileEditor`.

**Tech Stack:** Next.js 16, React 19, AI SDK (`streamText` + `Output.object`), Zod 4, Vitest + Testing Library (`fireEvent`), Playwright.

**Spec:** `docs/tech/2026-11-25-fase3-assistente-ia-perfil.md` (decisões D-01..D-11, todas vinculantes).

## Global Constraints

- Sem rota nova no servidor e sem host novo na CSP (RNF-03).
- Sem dependência npm nova, sem variável de ambiente nova, sem feature flag.
- Modelo: `task: "cv"` em `generateStructured`. Não criar `AiTask` nova.
- Schemas de saída de IA estritos: todos os campos obrigatórios, opcionais só via `.nullable()` (nunca `.optional()`).
- Texto vindo do perfil, das respostas ou do texto atual sempre dentro de `wrapUntrusted`. O perfil vai sem e-mail e sem telefone, e com o nome trocado por `[NOME]`.
- O assistente nunca grava no localStorage: só chama o `patch` do `ProfileEditor` (RN-21, RNF-04).
- Textos de UI em pt-BR com acentuação correta. Alvos de toque com `min-h-11`.
- Rótulos exatos:
  - "Escrever com IA", "Melhorar com IA", "Gerar", "Gerar de novo", "Cancelar", "Inserir no perfil", "Desfazer", "Tentar de novo";
  - "Conecte uma IA para usar o assistente", "Revisar perfil";
  - tons "Padrão", "Mais direto", "Mais técnico", "Traduzir";
  - idiomas "Português", "Inglês", "Espanhol".
- Mensagem de falha do RN-20 (D-04), exata: "A IA sugeriu fatos que não estão no seu perfil. Tente de novo ou responda com mais detalhes."
- Testes de componente usam `fireEvent` (o projeto não tem `@testing-library/user-event`).

## Review Focus

1. **Número por extenso ou com unidade** ("dez", "ten", "40%", "R$ 2 mil", "3 anos") ausente da entrada precisa ser rejeitado, e o mesmo número presente numa resposta precisa passar (Task 1).
2. **Tradução para en/es** não pode disparar falso positivo de nome próprio só por mudar caixa ou acento (Task 1).
3. **"Cancelar" durante o streaming** não pode deixar o painel em erro nem inserir o texto parcial (Task 4).
4. **Substituir bullets com destaque:** ao inserir bullets novos numa experiência que tinha bullets destacados, os ids removidos saem de `highlights`, e "Desfazer" restaura os dois (Task 5).
5. **Fechar o diálogo** descarta as respostas da entrevista, e nenhuma chave do localStorage muda até "Salvar perfil" (Task 5 e E2E na Task 8).

---

### Task 1: Validador do RN-20 sobre texto livre

**Files:**
- Modify: `lib/client/cv/validate.ts`
- Test: `tests/unit/client/assist-validate.test.ts`

**Interfaces:**
- Produces: `validateAssistOutput(profile: Profile, sourceText: string, texts: string[], opts?: { translated?: boolean }): Violation[]` e reaproveita `toPromptFeedback(violations)`.

- [ ] **Passo 1: testes que falham** (perfil fixture com a experiência "Lumen Pay / Frontend Sênior", 2019–2023, o bullet "Reduziu o tempo de build em 60%" e as skills React e TypeScript):
  - `"Aumentei a conversão em 35%"`, com `sourceText` vazio, dá violação `unknown_number` com texto "35%";
  - o mesmo texto com `sourceText` "aumentou a conversão em 35%" passa;
  - `"Liderei dez pessoas"` dá `unknown_number`, e `"Liderei 10 pessoas"` com `sourceText` "eram 10 pessoas" passa;
  - `"Desde 2015 atuo…"` dá `unknown_year`, mesmo com "2015" em `sourceText` (datas vêm só do perfil);
  - `"Trabalhei na Nubank"` dá `unknown_name`;
  - `"Usei Kubernetes"` dá `unknown_stack`, e passa se `sourceText` contém "kubernetes";
  - `"Reduced build time by 60% at Lumen Pay"` com `{ translated: true }` passa;
  - `"Reduziu o tempo de build em 60%"` passa.
- [ ] **Passo 2:** `pnpm vitest run tests/unit/client/assist-validate.test.ts`. Esperado: FAIL (função inexistente).
- [ ] **Passo 3: implementar** reaproveitando `prepareFacts`, os detectores de número, ano, stack e nome e as isenções do validador do CV. Fatos de número e stack = perfil + `sourceText`. Anos e nomes = só o perfil (com `translated`, compare nomes por `fold`). Números por extenso: tabela pt/en/es de 0–20, dezenas, "cem/cento/hundred/cien" e "mil/thousand". `where.part = "cv"` e `key` por hash do texto (`flags.ts`).
- [ ] **Passo 4:** rodar o teste. Esperado: PASS. Rodar também `tests/unit/client/cv-validate*.test.ts` (regressão do CV).
- [ ] **Passo 5: commit** `feat(ia): validador anti-invenção para textos do assistente`

### Task 2: Prompts `profile.assist.v1` e filtro do RN-22

**Files:**
- Create: `lib/client/ai/prompts/profile.assist.v1.ts`
- Test: `tests/unit/client/profile-assist-prompts.test.ts`

**Interfaces:**
- Produces:
  - `AssistTarget = { kind: "headline" } | { kind: "summary" } | { kind: "bullets"; expId: string }`;
  - `AssistTone = { tone: "default" | "direct" | "technical" } | { tone: "translate"; lang: "pt" | "en" | "es" }`;
  - `Draft = { text: string | null; bullets: string[] | null }`;
  - `ASSIST_QUESTIONS_V1: PromptDef<{profile; target}, {questions: string[]}>`;
  - `ASSIST_WRITE_V1: PromptDef<{profile; target; qa: {question: string; answer: string}[]}, {options: [Draft, Draft]}>`;
  - `ASSIST_REWRITE_V1: PromptDef<{profile; target; current: Draft; tone: AssistTone}, {draft: Draft}>`;
  - `sensitiveQuestion(q: string): boolean`.
- Ids: `"profile.assist.questions"`, `"profile.assist.write"`, `"profile.assist.rewrite"`, todos `version: 1`. `maxOutputTokens` 800, 1500 e 1200; `temperature` 0.4, 0.6 e 0.3 (D-02).

- [ ] **Passo 1: testes que falham.**
  - `questions` com 2 itens ou com 6 itens falha no schema; com 3 a 5 itens passa. Item com mais de 160 caracteres falha.
  - `options` precisa ter exatamente 2.
  - `buildUser` de cada prompt:
    - contém `id="` (delimitador do `wrapUntrusted`);
    - não contém o e-mail nem o telefone do perfil fixture;
    - troca o nome por `[NOME]`;
    - com `target.kind = "bullets"`, cita a empresa e o cargo da experiência.
  - `sensitiveQuestion`: "Qual a sua idade?", "Você é casado?", "Qual seu CPF?" e "What is your religion?" dão `true`; "Que tipo de produto você mais gosta de construir?" dá `false`.
  - O system de `ASSIST_REWRITE_V1` com `translate` e `lang: "en"` pede inglês.
- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3: implementar** seguindo `cv.tailor.v1.ts`. O perfil sai projetado com `projectProfileForTailor`/`nameRedactor` de `shared.ts`. As regras do system estão na D-01 e a regex de termos sensíveis na D-05.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5: commit** `feat(ia): prompts do assistente de perfil (perguntas, redação e reescrita)`

### Task 3: Serviço `assist.ts`

**Files:**
- Create: `lib/client/profile/assist.ts`
- Test: `tests/unit/client/profile-assist.test.ts`

**Interfaces:**
- Consumes: Task 1 e Task 2, além de `generateStructured` e `AiError`.
- Produces (todas com `{ settings, signal?, onPartial?, resolveModel? }`):
  - `askQuestions({ profile, target, ... }): Promise<string[]>`;
  - `writeDrafts({ profile, target, qa, ... }): Promise<[Draft, Draft]>`;
  - `rewriteDraft({ profile, target, current, tone, ... }): Promise<Draft>`;
  - `ASSIST_INVENTED_MESSAGE`, com o texto exato da D-04.

- [ ] **Passo 1: testes que falham.** Usar um `resolveModel` falso com `MockLanguageModelV3` do `ai/test` (o padrão já existe nos testes de `generate`):
  - **Perguntas:**
    - com uma pergunta sensível na 1ª resposta e nenhuma na 2ª, devolve as da 2ª;
    - com uma sensível nas duas respostas e 4 limpas na 2ª, devolve as 4 limpas;
    - com 2 limpas e 1 sensível nas duas respostas, lança `AiError` `invalid_output`.
  - **Redação:** número inventado nas duas chamadas lança `invalid_output`. O número presente numa resposta passa. `[NOME]` na saída vira o nome do perfil.
  - **Reescrita:** `sourceText` inclui o texto atual, e "Traduzir" passa `translated: true` ao validador.
  - **Cancelamento:** `signal` abortado repassa `AbortError`.
- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3: implementar.** O `validate` de cada chamada:
  - perguntas: usa `sensitiveQuestion` e, na última chamada, filtra as perguntas sensíveis se sobrarem pelo menos 3;
  - redação e reescrita: usa `validateAssistOutput` + `toPromptFeedback`.
  - Para `target.kind = "bullets"`, os textos validados são os bullets.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5: commit** `feat(perfil): serviço do assistente com validação e retentativa`

### Task 4: `AssistantDialog` (entrevista e reescrita)

**Files:**
- Create: `components/profile/assistant/AssistantDialog.tsx`, `InterviewFlow.tsx`, `RewriteFlow.tsx`
- Test: `tests/unit/client/assistant-dialog.test.tsx`

**Interfaces:**
- Consumes: Task 3 (com `vi.mock("@/lib/client/profile/assist")` nos testes), `Dialog` (`mobile="sheet"`), `NoProviderCta`, `hasUsableProvider` e `aiSettingsStore`.
- Produces: `AssistantDialog({ open, onOpenChange, profile, target, current, onInsert }: { open: boolean; onOpenChange: (o: boolean) => void; profile: Profile; target: AssistTarget; current: Draft; onInsert: (d: Draft) => void })`. Com `current` vazio abre a entrevista; preenchido, abre a reescrita.

- [ ] **Passo 1: testes que falham.**
  - **Sem provedor:** aparece "Conecte uma IA para usar o assistente", com link para `/configuracoes`.
  - **Entrevista:**
    - mostra 3 perguntas, cada uma com `textarea` rotulada;
    - "Gerar" chama `writeDrafts` com as respostas, e as perguntas puladas vão com `answer: ""`;
    - aparecem 2 opções em `radiogroup`; escolher a 2ª e editar a `textarea` muda o texto;
    - "Inserir no perfil" chama `onInsert` com o texto editado e fecha.
  - **Reescrita:**
    - mostra "Texto atual" e "Sugestão";
    - trocar o tom para "Traduzir" mostra o `select` de idioma;
    - "Gerar de novo" chama `rewriteDraft` com `{ tone: "translate", lang: "en" }`.
  - **Bullets:** a prévia tem uma `textarea` por bullet e "Remover" tira um.
  - **Cancelar:** durante a geração (promise pendente), "Cancelar" aborta o `signal` passado e volta ao passo anterior, sem mensagem de erro e sem `onInsert`.
  - **Erro:** com `invalid_output`, aparece a mensagem exata da D-04 e o botão "Tentar de novo".
  - **Acessibilidade:** existe uma região `aria-live="polite"` que mostra o texto parcial vindo de `onPartial`.
- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3: implementar** conforme a D-06. Um `AbortController` por geração, abortado também ao fechar. As respostas ficam no estado local. Layout lado a lado só em `md:`.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS. Depois, `pnpm typecheck && pnpm lint`.
- [ ] **Passo 5: commit** `feat(perfil): painel do assistente de IA com entrevista e reescrita`

### Task 5: Botões no editor, inserir e desfazer

**Files:**
- Modify: `components/profile/ProfileEditor.tsx`, `components/profile/ExperienceEditor.tsx`
- Create: `components/profile/assistant/AssistButton.tsx`
- Test: `tests/unit/client/profile-assist-editor.test.tsx`

**Interfaces:**
- Consumes: `AssistantDialog` (Task 4, mockado no teste para chamar `onInsert` direto), `toast` do `sonner` e `nextSeq` de `components/profile/ids.ts`.
- Produces: `AssistButton({ empty, onClick })`, com rótulo "Escrever com IA" quando `empty` e "Melhorar com IA" quando não.

- [ ] **Passo 1: testes que falham.**
  - **Rótulos:** título vazio mostra "Escrever com IA" e título preenchido mostra "Melhorar com IA". O mesmo vale para o resumo e para os bullets de uma experiência aberta. Os botões não aparecem com a experiência recolhida.
  - **Inserir no resumo:**
    - muda o valor da `textarea` do resumo;
    - mostra o toast com "Desfazer";
    - `localStorage.setItem` não é chamado (spy);
    - aparece o estado de alterações não salvas.
  - **Desfazer** restaura o valor anterior.
  - **Inserir bullets:**
    - numa experiência com `exp_1.b1` destacado, substitui os bullets;
    - os ids novos não reaproveitam `exp_1.b1`;
    - `exp_1.b1` sai de `highlights`;
    - "Desfazer" restaura os bullets e `highlights`.
- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3: implementar** conforme a D-07 e a D-08. O toast usa `duration: 8000`. Guarde o snapshot anterior (campo ou `{experiences, highlights}`) para o desfazer.
- [ ] **Passo 4:** rodar o teste e os de `profile-editors.test.tsx`. Esperado: PASS.
- [ ] **Passo 5: commit** `feat(perfil): botões do assistente de IA com inserir e desfazer`

### Task 6: Revisar perfil e sugestão de skills (Should)

**Files:**
- Create: `lib/client/profile/review.ts`, `components/profile/ProfileReview.tsx`, `components/profile/SkillSuggestions.tsx`
- Modify: `components/profile/ProfileEditor.tsx`
- Test: `tests/unit/client/profile-review.test.ts`, `tests/unit/client/profile-review-ui.test.tsx`

**Interfaces:**
- Produces:
  - `Finding = { kind: "bullet_no_verb" | "bullet_long" | "summary_long" | "skill_missing"; where: { field: "summary" } | { field: "bullet"; expId: string; bulletId: string } | { field: "skills"; stackId: string }; message: string }`;
  - `reviewProfile(profile: Profile): Finding[]`;
  - `suggestSkills(profile: Profile): { stackId: string; label: string }[]`.

- [ ] **Passo 1: testes que falham.**
  - **Verbo de ação:**
    - "fiz o sistema de pagamentos" dá `bullet_no_verb`, porque "fiz" fica fora da lista e não tem as terminações;
    - "Desenvolvi o sistema…", "Liderou a migração…" e "Built the payments system" não dão;
    - "Responsável pelo sistema" dá `bullet_no_verb`.
  - **Tamanho:** bullet de 201 caracteres dá `bullet_long`, e um resumo de 601 caracteres dá `summary_long`.
  - **Skills:**
    - o bullet "Migrei para Kubernetes" sem Kubernetes em `skills` faz `suggestSkills` devolver `{ stackId: "kubernetes", … }`;
    - com Kubernetes em `skills` não há sugestão.
  - **UI:**
    - "Revisar perfil" lista os achados;
    - "Corrigir" num achado de bullet abre o `AssistantDialog` em reescrita para aquela experiência (mock);
    - o chip "+ Kubernetes" adiciona a skill com `years: null` ao rascunho e some.
- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3: implementar** conforme a D-09 e a D-10. A lista de verbos fica em `review.ts`, com cerca de 60 verbos pt/en no infinitivo, no passado em 1ª e 3ª pessoa e em inglês no passado.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS.
- [ ] **Passo 5: commit** `feat(perfil): revisão determinística do perfil e sugestão de skills`

### Task 7: Suíte `assist` no eval

**Files:**
- Modify: `scripts/eval-ai.ts`, `scripts/eval-ai/core.ts`, `scripts/eval-ai/mock.ts`
- Test: `tests/unit/scripts/eval-assist.test.ts` (siga a pasta e o padrão dos testes existentes do eval, se houver; senão, crie aqui)

**Interfaces:**
- Consumes: Task 3. Perfis dos pares `01..10` de `tests/fixtures/ai/pairs`.
- Produces:
  - flag `--suite assist` (o padrão continua sendo a suíte atual);
  - função `runAssistSuite(profiles, deps): Promise<AssistReport>`, com `AssistReport = { generations: number; invented: number; sensitive: number; p95Ms: number; failures: {profile: string; step: string; detail: string}[] }`.

- [ ] **Passo 1: teste que falha.** Em modo mock, `runAssistSuite` com 10 perfis faz 30 gerações (perguntas do resumo, redação com respostas fixas sem números e reescrita "Mais direto" do 1º bullet) e devolve `invented: 0`. Com um mock que injeta "45%" na redação, devolve `invented >= 1` e um item em `failures`.
- [ ] **Passo 2:** rodar o teste. Esperado: FAIL.
- [ ] **Passo 3: implementar** reaproveitando o carregamento de pares, o relatório e o mock existentes. Conte as violações com `validateAssistOutput` e `sensitiveQuestion` sobre a saída **antes** de qualquer filtro do serviço. Use as funções de baixo nível com um `validate` que só registra, para medir o modelo.
- [ ] **Passo 4:** rodar o teste. Esperado: PASS. `pnpm eval:ai --suite assist --mock`, ou o equivalente que o script aceite, deve terminar com 0 inventados.
- [ ] **Passo 5: commit** `test(ia): suíte do assistente de perfil no eval`

### Task 8: E2E e verificação final

**Files:**
- Create: `tests/e2e/profile-assistant.spec.ts`
- Modify: `tests/e2e/profile.spec.ts`, só se for preciso compartilhar fixtures

**Interfaces:**
- Consumes: tudo acima. Provedor falso via `page.route` do endpoint de chat, no padrão de `tests/e2e/generator.spec.ts` (perfil v2 e `AI_SETTINGS` no localStorage).

- [ ] **Passo 1: E2E** (devem passar):
  1. **Entrevista do resumo:** "Escrever com IA" → 3 perguntas → responder 1 e pular 2 → "Gerar" → escolher a opção 2 → "Inserir no perfil". O resumo muda e sair por link interno pede confirmação. "Salvar perfil" grava, e o resumo persiste depois de recarregar.
  2. **Bullet:** "Melhorar com IA" na experiência 1 → tom "Mais direto" → "Inserir no perfil" → "Desfazer" restaura.
  3. **Número inventado:** o provedor devolve um número inventado nas 2 chamadas e aparece a mensagem exata da D-04.
  4. **RNF-04:** depois de responder e fechar o painel sem inserir, o snapshot das chaves `jobfind:*` do localStorage é igual ao de antes.
  5. **RNF-05:** ao abrir, o foco está no primeiro campo; existe `[aria-live="polite"]`; o fluxo 1 roda só com `Tab`, `Space` e `Enter`.
  6. **Sem IA configurada:** sem `AI_SETTINGS`, o clique mostra "Conecte uma IA para usar o assistente".
- [ ] **Passo 2:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Esperado: tudo verde.
- [ ] **Passo 3:** `pnpm test:e2e`. Esperado: tudo verde.
- [ ] **Passo 4:** se houver correção, commit `fix: ajustes da verificação final da Fase 3`.
