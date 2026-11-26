# Fase 4: pendências menores — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fechar as 27 pendências menores que as revisões das Fases 1 a 3 registraram e que ainda existem no código (varredura de 2026-11-25 na `feat/fase4-pendencias-menores`, HEAD `60d8038`).

**Architecture:** só correções pontuais e testes, sem módulo novo, dependência nova, variável de ambiente ou feature flag. Cada tarefa cobre uma área (vagas, guard, editor, validador, UI do assistente, E2E) e fica independente das outras.

**Tech Stack:** Next.js 16, React 19, Tailwind 4 (tokens `jf-*`), Vitest + Testing Library (`fireEvent`), Playwright, Zod, lucide-react.

**Spec:** `docs/prd/2026-11-25-glassdoor-filtros-ia-perfil-templates-cv.md`, mais as specs das fases em `docs/tech/2026-11-25-fase1-glassdoor-filtros-persistentes.md`, `docs/tech/2026-11-25-fase2-templates-cv.md` e `docs/tech/2026-11-25-fase3-assistente-ia-perfil.md`. Cada item abaixo leva o número que tinha na varredura (#N).

## Global Constraints

- Textos de UI em pt-BR com acentuação correta.
- Cores só com tokens `jf-*`. Um teste barra hex, `bg-white` e `text-white` em `components/` e `app/`.
- Sem variáveis de ambiente, feature flags ou dependências novas.
- Nada salva o perfil sozinho: inserir ou desfazer só altera o rascunho (D-08 da Fase 3).
- Anti-invenção (D-04 da Fase 3): nenhum número, ano ou tecnologia na saída da IA que não esteja no perfil ou nas respostas.
- Limite de 3 destaques (`MAX_HIGHLIGHTS`).
- Commits em pt-BR no formato `tipo(escopo): descrição`, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Em loops de espera, nunca use `pgrep -f "<padrão literal>"` dentro do mesmo comando (ele acha o próprio loop). Rode os comandos em primeiro plano.
- Verificação por tarefa: `pnpm vitest run <arquivos tocados>`, `pnpm typecheck` e `pnpm lint`. Na T6, também `pnpm exec playwright test <specs>`.

## Review Focus

1. Abrir `/?ocultas=1` ou alternar "ocultas" não pode apagar nem esconder a última busca salva (T1).
2. "Desfazer" depois de mexer em destaques nunca deixa mais de 3 (T3).
3. Um ano inventado em qualquer posição da frase ("Durante 2019…", "2019 marcou…") é barrado. Quantidades vindas das respostas ("2000 usuários", "1500 e-mails") continuam passando (T4).
4. Digitar e voltar ao valor original no perfil não deixa o aviso de alterações não salvas ligado (T2).
5. Uma resposta da IA sem o campo do alvo, ou com pergunta em branco, vira erro claro e não uma sugestão vazia (T4).

---

### Task 1: Vagas, filtros e última busca (#1, #2, #3, #4, #5, #6, #7, #9)

**Files:**
- Modify: `components/jobs/JobCardMenu.tsx`, `lib/client/jobs/saved-search.ts`, `components/jobs/JobsPage.tsx`, `components/jobs/RestoredNotice.tsx`, `components/jobs/BackToJobsLink.tsx`
- Test: `tests/unit/client/job-detail.test.tsx`, `tests/unit/client/saved-search.test.ts`, `tests/unit/client/restore-filters.test.ts`, `tests/unit/client/jobs/back-to-jobs-link.test.tsx`, `tests/e2e/job-detail.spec.ts`

- [ ] **Passo 1: testes que falham.**
  - **#4:** com uma última busca salva, montar `useRememberFilters` com filtros que só têm `showHidden: true`. A store continua com a busca salva (não vira `null`).
  - **#3:**
    - semear `savedAt` expirado e afirmar que o efeito renova `savedAt` quando os filtros mudam de verdade;
    - com `vi.useFakeTimers`, `age === 7 dias` exatos ainda é fresco e `7 dias + 1 ms` não é.
  - **#5:** trocar os `as never` de `saved-search.test.ts` por props tipadas `PageFilters` (com `satisfies`).
  - **#7, aviso de busca restaurada:**
    - depois de mudar um filtro e voltar ao valor restaurado, o aviso não reaparece;
    - alternar "ocultas" não esconde o aviso;
    - o elemento `role="status"` existe vazio na montagem e só depois recebe o texto.
  - **#6:** `it.each` com meta, shift, alt, `button: 1` e um clique já `defaultPrevented`. Nenhum desses casos chama `router.back()`.
  - **#2:** trocar o `innerHTML.not.toContain("glassdoor")` por `queryByRole("link", { name: /glassdoor/i })` nulo.
  - **#9:** no E2E, o regex passa a ser `/^https:\/\/www\.glassdoor\.com\.br\/Search\//`.
- [ ] **Passo 2:** rodar os testes. Esperado: FAIL em #4, #6 e #7. Os de #2, #3, #5 e #9 só ficam mais rígidos.
- [ ] **Passo 3: implementar.**
  - **#4:** em `saved-search.ts`, só gravar `null` quando a URL tiver um filtro salvável que foi limpo. URL sem filtro salvável (só `ocultas`) não toca na store.
  - **#7:**
    - estado `dismissed` que vira `true` no primeiro desvio e não volta;
    - a chave do aviso ignora `showHidden`;
    - `RestoredNotice` sempre renderiza o `<p role="status">` e preenche o texto num efeito depois da montagem.
  - **#6:** `BackToJobsLink` sai cedo se `e.defaultPrevented`.
  - **#1:** ícone `ExternalLink` (lucide, `aria-hidden`) no item do Glassdoor do menu, igual ao `JobDetail.tsx:403`.
- [ ] **Passo 4:** rodar os testes da tarefa, `pnpm exec playwright test tests/e2e/job-detail.spec.ts`, `pnpm typecheck` e `pnpm lint`. Esperado: PASS.
- [ ] **Passo 5: commit** `fix(vagas): última busca, aviso restaurado e link do Glassdoor`

### Task 2: Aviso de alterações não salvas no perfil (#8, #24)

**Files:**
- Modify: `components/profile/ProfileEditor.tsx`, `lib/client/use-unsaved-changes-guard.ts`
- Test: `tests/unit/client/unsaved-changes-guard.test.tsx`, `tests/unit/client/profile-editors.test.tsx` (ou o teste do `ProfileEditor` que já existe)

- [ ] **Passo 1: testes que falham.**
  - **Dirty calculado:** digitar no título e depois voltar ao valor salvo deixa `dirty === false`. Editar e salvar também.
  - **Barra final:** clicar num link para `/perfil/` estando em `/perfil` não pergunta.
  - **Search e hash:** link para o mesmo caminho com outra search ou outro hash também não pergunta. **Decisão:** é a mesma tela e o rascunho continua montado.
  - **`pagehide`:** com `dirty`, disparar `pagehide` não lança erro e não chama `confirm`. Com `persisted: false` vale o mesmo comportamento do `beforeunload`. Leia o hook e afirme o que ele faz hoje. Se ele não trata `pagehide`, o teste documenta que o `beforeunload` cobre o caso.
  - **#24:** os testes de clique passam a chamar `preventDefault` (ou usam um `href` que o jsdom não navega). O arquivo roda sem nenhuma linha "Not implemented: navigation to another Document" no stderr.
- [ ] **Passo 2:** rodar. Esperado: FAIL nos dois primeiros.
- [ ] **Passo 3: implementar.**
  - **Dirty:** derivar de `!isEqual(draft, savedProfile)`, com comparação estrutural via `JSON.stringify` dos dois perfis normalizados. Fica no lugar de `setDirty(true)` no `patch`.
  - **Comparação de caminho:** remover a barra final dos dois lados antes de comparar.
- [ ] **Passo 4:** rodar os testes, `pnpm typecheck` e `pnpm lint`. Esperado: PASS e stderr limpo.
- [ ] **Passo 5: commit** `fix(perfil): alterações não salvas comparam o rascunho com o perfil`

### Task 3: Editor de experiências e projetos, CV e docs (#13, #14, #15, #16, #17, #22, #23)

**Files:**
- Modify: `components/profile/ExperienceEditor.tsx`, `components/profile/ProjectsEditor.tsx`, `lib/client/cv/assemble.ts` (comentário), `docs/tech/2026-11-25-fase2-templates-cv.md`, `docs/plans/2026-11-25-fase2-templates-cv.md`
- Test: `tests/unit/client/profile-editors.test.tsx`, `tests/unit/client/profile-assist-editor.test.tsx`

- [ ] **Passo 1: testes que falham.**
  - **#13:** experiência com `exp_1.b2` destacado. Clicar em "Remover experiência" deixa `hl` vazio.
  - **#14:** com a experiência recolhida, o `<li>` do bullet destacado tem o texto acessível "(destacado)" (`sr-only`) e um ícone de estrela `aria-hidden`. Os outros `<li>` não têm.
  - **#15:** `ProjectsEditor` re-renderizado com `stacks` novas vindas de fora (por exemplo, depois de um desfazer) mostra o texto novo no campo Tecnologias.
  - **#22:**
    - inserir bullets numa experiência com 1 destaque fora dela e 2 dentro;
    - destacar mais 2 bullets;
    - clicar em "Desfazer" no toast;
    - `highlights.length <= 3`.
  - **#23:** remover o último bullet (`exp_1.b4`), inserir bullets pelo assistente e afirmar que nenhum id novo é `exp_1.b4`.
- [ ] **Passo 2:** rodar. Esperado: FAIL em #13 (se o teste revelar falha), #14, #15 e #22.
- [ ] **Passo 3: implementar.**
  - **#22:** `.slice(0, MAX_HIGHLIGHTS)` em `[...kept, ...restored]`.
  - **#14:** estrela `Star` do lucide (`aria-hidden`), com cor por token, mais `<span className="sr-only">(destacado)</span>`.
  - **#15:** ressincronizar o texto local quando `item.stacks.join(", ")` mudar de fora. Guarde a última chave vista em estado e compare no render, sem efeito.
  - **#16:** **decisão:** o NFC continua só na renderização (`CvDocument`). Adicionar um comentário em `assembleCv` dizendo isso e por quê: o validador compara com o perfil cru.
  - **#17:** nos dois docs da Fase 2, "Source Sans 3" vira "JF Sans" e "IBM Plex Sans" vira "JF Grotesk", conforme `lib/client/pdf/fonts.ts`.
- [ ] **Passo 4:** rodar os testes da tarefa, `pnpm typecheck` e `pnpm lint`. Esperado: PASS.
- [ ] **Passo 5: commit** `fix(perfil): destaques no desfazer e na experiência recolhida`

### Task 4: Validador, prompts e eval do assistente (#18, #19, #20, #21, #26, #30)

**Files:**
- Modify: `lib/client/cv/validate.ts`, `lib/client/ai/prompts/profile.assist.v1.ts`, `lib/client/ai/prompts/untrusted.ts` (só se precisar), `lib/client/profile/assist.ts`, `scripts/eval-ai/core.ts`
- Test: `tests/unit/client/assist-validate.test.ts`, `tests/unit/client/profile-assist-prompts.test.ts`, `tests/unit/client/profile-assist.test.ts`, `tests/unit/client/eval-ai/*`

- [ ] **Passo 1: testes que falham.**
  - **#18, anos no modo assist.** Perfil sem 2019 e respostas citadas em cada caso:

    | Saída | Respostas | Esperado |
    |---|---|---|
    | "Durante 2019 entreguei X" | sem 2019 | violação |
    | "2019 marcou a migração" | sem 2019 | violação |
    | "Em 2019 liderei X" | "em 2019 eu liderei" | violação (ano das respostas usado como data) |
    | "plataforma de 2000 usuários" | "2000 usuários" | passa |
    | "1500 e-mails por dia" | "1500 e-mails" | passa |
    | "Desde 2021 atuo" | perfil com `startDate` 2021 | passa |
  - **#19, perguntas sensíveis:**
    - Devem casar: "Qual a sua idade?", "Tem filhos?", "Você é solteiro?", "Is she married?" e "Qual a cor da sua pele?".
    - Não devem casar: "Qual sua cor favorita?", "Você tem kids mode?", "o componente has children" e "seu children prop".
  - **#20, entrada e limites:**
    - perguntas `["", "  "]` viram `invalid_output`;
    - uma pergunta vazia entre válidas é descartada;
    - `targetBlock` com `expId` inexistente lança `Error`;
    - um perfil maior que `PROFILE_MAX_CHARS` gera um bloco `wrapUntrusted` com JSON válido (`JSON.parse` do conteúdo não lança), com bullets podados.
  - **#21:** o id da experiência aparece dentro do bloco `wrapUntrusted`, e não fora dele.
  - **#30:**
    - `restoreName` sem nome no perfil preserva `[NOME]`, e o validador marca a violação;
    - rascunho `{text: null}` para summary e `{bullets: null}` para bullets vira `invalid_output` com feedback.
  - **#26:** no eval, um caso que devolve o campo vazio ou nulo conta como falha, não como geração limpa.
- [ ] **Passo 2:** rodar. Esperado: FAIL.
- [ ] **Passo 3: implementar.**
  - **#18:** no modo assist, um número de 1900 a 2099 só passa se estiver no perfil. Se vier só das respostas, passa apenas quando o par "número + palavra seguinte" aparece igual nas respostas e a palavra seguinte não é mês nem há preposição de data antes (`DATE_BEFORE`). Corrigir também o `RANGE_AFTER` para não casar o "e" de "e-mails" (exigir espaço ou fim depois do "e").
  - **#19:** ampliar o regex com `idade` avulsa, `tem filh`, `solteir`, `married`, e `cor` só junto de `pele|etnia|raça`. Para `has` e `have`, exigir pronome pessoal antes (`she|he|they|you`).
  - **#20:**
    - `AssistQuestions`: cada item com `.trim()`, descartar vazios depois do parse e falhar com zero perguntas;
    - `targetBlock`: lançar `Error` em `expId` inexistente;
    - limite: podar bullets, das experiências mais antigas para as mais novas, até o JSON caber em `PROFILE_MAX_CHARS`, em vez de cortar a string.
  - **#21:** mover a linha do id para dentro do bloco.
  - **#26:** `write` falha se vier menos de 2 textos. `rewrite` falha se vier zero.
- [ ] **Passo 4:** rodar os testes da tarefa, `pnpm tsx scripts/eval-ai.ts --suite assist --mock`, `pnpm typecheck` e `pnpm lint`. Esperado: PASS e "Resultado: APROVADO".
- [ ] **Passo 5: commit** `fix(ia): anos, perguntas sensíveis e entradas do assistente`

### Task 5: UI do assistente e revisão do perfil (#25, #27, #28)

**Files:**
- Modify: `lib/client/profile/review.ts`, `components/profile/SkillSuggestions.tsx`
- Test: `tests/unit/client/profile-review.test.ts`, `tests/unit/client/profile-review-ui.test.tsx`, `tests/unit/client/assistant-dialog.test.tsx`

- [ ] **Passo 1: testes que falham.**
  - **#25, mensagem:** a mensagem de `skill_missing` passa a ser "aparece ou está implícita nas suas realizações".
  - **#25, verbos:** "Implementamos o checkout" e "Leading a squad" deixam de ser marcados como sem verbo.
  - **#25, anúncio:** ao adicionar uma competência sugerida, um `role="status"` anuncia "React adicionada às competências".
  - **#27:** o mock de `assistant-dialog.test.tsx` usa `vi.importActual` para `ASSIST_INVENTED_MESSAGE`, e o teste compara com a constante real.
  - **#28, cinco casos novos em `assistant-dialog.test.tsx`:**
    1. `rewriteDraft` rejeita com erro, não aborto, e aparece o alerta genérico com "Tentar de novo";
    2. `askQuestions` rejeita e aparece o alerta com "Tentar de novo";
    3. inserir uma reescrita de bullets chama `onInsert` com a lista editada;
    4. fechar o painel durante a geração deixa o `signal` em `aborted`;
    5. com `aiSettingsStore` nulo, aparece o aviso sem provedor e nenhuma chamada de IA.
- [ ] **Passo 2:** rodar. Esperado: FAIL em #25. Os de #28 podem passar de primeira; se algum falhar, é bug a corrigir.
- [ ] **Passo 3: implementar** a mensagem, o regex de verbos (`/(ei|ou|iu|amos|emos|imos|ed|ing)$/`) e a região `role="status"` em `SkillSuggestions`.
- [ ] **Passo 4:** rodar os testes da tarefa, `pnpm typecheck` e `pnpm lint`. Esperado: PASS.
- [ ] **Passo 5: commit** `fix(perfil): revisão de competências e testes do painel do assistente`

### Task 6: E2E de modelo de CV e de teclado (#11, #12, #29)

**Files:**
- Test: `tests/e2e/generator.spec.ts`, `tests/e2e/profile-assistant.spec.ts`

- [ ] **Passo 1: escrever os cenários.**
  - **#11:** escolher Harvard, clicar em "Regenerar" e afirmar que o registro salvo tem `templateId === "harvard"` e que o botão mostra "Modelo do CV: Harvard".
  - **#12:** numa vaga nova sem registro:
    - o selo "Recomendado para você" está no modelo recomendado para aquela vaga (nome afirmado);
    - o botão "Modelo do CV: <esse nome>" já vem com ele.
  - **#29:**
    - chegar ao botão "Escrever com IA" com `Tab` real (sem `focus()`);
    - abrir com `Enter`;
    - responder;
    - escolher a opção 2 com setas e `Espaço`;
    - inserir;
    - chegar a "Salvar perfil" com `Tab` e salvar com `Enter`;
    - afirmar que o perfil salvo tem o texto da opção 2.
- [ ] **Passo 2:** rodar `pnpm exec playwright test tests/e2e/generator.spec.ts tests/e2e/profile-assistant.spec.ts`. Esperado: PASS. Se algum falhar, investigar se o defeito é do app e corrigir na própria tarefa.
- [ ] **Passo 3: commit** `test(e2e): modelo do CV ao regenerar, recomendação e assistente só com teclado`

## Decisão registrada

`/?ocultas=1` não restaura a última busca (comportamento da Fase 1, coberto por teste); a store só não é apagada.
