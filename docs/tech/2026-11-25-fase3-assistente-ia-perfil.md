# Spec técnica — Fase 3: assistente de IA no perfil

- **PRD:** `docs/prd/2026-11-25-glassdoor-filtros-ia-perfil-templates-cv.md` (seção 7.3, RN-20..22, RNF-03..06)
- **Escopo:** RF-20, 21, 22, 23, 24, 25 (Must) e RF-27, 28 (Should). O RF-26 (aviso de alterações não salvas) entrou na Fase 1.
- **Depende de:** Fase 2 (perfil v2). O branch `feat/fase3-assistente-ia` sai de `feat/fase2-templates-cv` (PR #29).
- **Data:** 2026-11-25

## 1. O que existe e será reaproveitado

| Peça | Onde | Uso na Fase 3 |
|---|---|---|
| `generateStructured` | `lib/client/ai/generate.ts` | Streaming, Zod, `validate`, `MAX_CALLS = 2`, `AbortSignal`, erros `AiError`. Sem mudança. |
| `PromptDef` | `lib/client/ai/prompts/types.ts` | Formato dos 3 prompts novos. |
| `wrapUntrusted` | `lib/client/ai/prompts/untrusted.ts` | Textos do perfil e respostas entram como dado delimitado. |
| Validador anti-invenção | `lib/client/cv/validate.ts` (`prepareFacts`, números, stacks, nomes) | Base do RN-20. Ganha uma entrada para texto livre. |
| `hasUsableProvider`, `NoProviderCta` | `lib/client/ai/model.ts`, `components/settings/NoProviderCta.tsx` | US-05 (sem IA configurada). |
| `Dialog` com `mobile="sheet"` | `components/ui/dialog.tsx` | Painel do assistente: sheet no celular, diálogo no desktop. |
| `sonner` | `components/ui/sonner.tsx` | "Desfazer" por 8 s. |
| `extractStacks`, `normalizeSkill` | `lib/shared/stacks.ts` | RF-28 e checagem de tecnologia do RN-20. |
| `pnpm eval:ai` + `tests/fixtures/ai/pairs/*.json` | `scripts/eval-ai*` | RF-25: os perfis dos pares viram o conjunto de 10 perfis do assistente. |

## 2. Decisões

### D-01 — Um módulo de prompts com três `PromptDef`
`lib/client/ai/prompts/profile.assist.v1.ts` exporta:

| Prompt | Entrada | Saída (Zod, estrita, `nullable` em vez de `optional`) |
|---|---|---|
| `ASSIST_QUESTIONS_V1` | `{ profile, target }` | `{ questions: string[] }` com 3 a 5 itens, cada um com até 160 caracteres |
| `ASSIST_WRITE_V1` | `{ profile, target, qa: {question, answer}[] }` | `{ options: [Draft, Draft] }` (exatamente 2) |
| `ASSIST_REWRITE_V1` | `{ profile, target, current, tone }` | `{ draft: Draft }` |

- `target` é `{ kind: "headline" } | { kind: "summary" } | { kind: "bullets", expId }`.
- `Draft` é `{ text: string | null, bullets: string[] | null }`. Para `headline` e `summary` vem `text`; para `bullets`, a lista.
- `tone` é `"default" | "direct" | "technical" | "translate"`, e `"translate"` leva também `lang: "pt" | "en" | "es"`.
- O system prompt segue o tom do `cv.tailor.v1`. Ele proíbe inventar números, empresas, cargos, datas e tecnologias, pede verbo de ação + o quê + resultado (quando houver) nos bullets e proíbe perguntas sobre dados sensíveis (RN-22).
- O perfil vai como JSON projetado: sem e-mail, telefone ou endereço, e com o nome trocado por `[NOME]`, como o `projectProfileForTailor` já faz. Respostas e texto atual vão dentro de `wrapUntrusted`.
- **Alternativa descartada:** um prompt único com modo. Os schemas de saída são diferentes e o eval fica mais claro com três.

### D-02 — Modelo: o da tarefa `cv` (premissa P-03)
Não entra tarefa nova em `AiTask` nem tela nova de configuração. `maxOutputTokens`: 800 para perguntas, 1500 para redação e 1200 para reescrita. Temperaturas: 0.4 nas perguntas, 0.6 na redação e 0.3 na reescrita.

### D-03 — Validador do RN-20 sobre texto livre
Nova função `validateAssistOutput(profile, sourceText, texts)` em `lib/client/cv/validate.ts`, reaproveitando os detectores internos (números, anos, stacks, nomes capitalizados, siglas):

- `sourceText` é a concatenação das respostas da entrevista e do texto atual que o usuário pediu para reescrever. É fonte de fatos junto com o perfil inteiro.
- **Números** (inteiros, %, valores, durações e números por extenso de 0 a 20, dezenas, "cem", "mil", em pt, en e es) precisam aparecer no perfil ou em `sourceText`.
- **Anos** só valem se vêm do perfil (RN-20: "datas vêm só do perfil").
- **Empresas, cargos e nomes próprios** capitalizados no meio da frase precisam existir no perfil, com a mesma regra do CV.
- **Stacks do dicionário** precisam aparecer no perfil ou em `sourceText`.
- **Retorno:** `Violation[]`, com `where.part = "cv"`, mais `toPromptFeedback` para a retentativa.
- **Na tradução** (`tone: "translate"`), números e stacks continuam comparados. Nomes próprios comparados ignorando caixa e acentos.

### D-04 — Falha depois de 2 chamadas vira erro claro
Diferente do CV, aqui não existe "Aprovar mesmo assim". Se a segunda chamada ainda violar o RN-20, `generateStructured` lança `invalid_output` e o painel mostra: "A IA sugeriu fatos que não estão no seu perfil. Tente de novo ou responda com mais detalhes." A mensagem traz o botão "Tentar de novo".

### D-05 — Filtro determinístico do RN-22
`validate` do `ASSIST_QUESTIONS_V1` rejeita pergunta que case com termos sensíveis, com regex em pt, en e es: idade, nascimento, estado civil, casad, filhos, gravidez, saúde, doença, deficiência, religião, igreja, CPF, RG, endereço, CEP, raça, cor da pele, orientação sexual e salário atual. A rejeição dispara a retentativa. Se a segunda resposta ainda trouxer uma pergunta sensível, ela é descartada no cliente, desde que sobrem pelo menos 3. Se sobrarem menos de 3, vale o erro da D-04.

### D-06 — Painel do assistente
- **Componentes:** `components/profile/assistant/AssistantDialog.tsx`, que usa `Dialog` com `mobile="sheet"`, e as subtelas `InterviewFlow.tsx` e `RewriteFlow.tsx`.
- **Entrevista (RF-21):**
  1. Busca as perguntas.
  2. Mostra uma `textarea` por pergunta (todas opcionais) e o botão "Gerar".
  3. Mostra 2 opções em `radiogroup`, com a escolhida editável numa `textarea`, e o botão "Inserir no perfil".
- **Reescrita (RF-22):**
  - Mostra o texto atual e o sugerido lado a lado no desktop (`md:grid-cols-2`) e empilhados no celular.
  - Um `select` de tom tem as opções "Padrão", "Mais direto", "Mais técnico" e "Traduzir". "Traduzir" abre o `select` de idioma, com "Português", "Inglês" e "Espanhol".
  - O botão "Gerar de novo" refaz a sugestão com o tom escolhido.
- **Streaming:** o texto parcial aparece numa região `aria-live="polite"`.
- **"Cancelar"** aborta o `AbortController` e volta ao passo anterior sem erro.
- **Foco:** vai para o primeiro campo de cada passo. Os alvos têm pelo menos 44 px (`min-h-11`).
- **Bullets (`kind: "bullets"`):** a prévia é uma lista editável, com uma `textarea` por bullet e o botão "Remover". Ao inserir, os bullets **substituem** os da experiência. Os ids saem do contador de `components/profile/ids.ts`, e destaques de ids removidos saem de `highlights`.
- **Alternativa descartada:** um painel lateral fixo no desktop. Ele ocupa o editor, e o `Dialog` já existe com foco gerenciado.

### D-07 — Botões e quando aparecem (RF-20)
- **Onde:** "Escrever com IA" quando o campo está vazio e "Melhorar com IA" quando está preenchido, em três lugares: no título, no resumo e no conjunto de bullets de cada experiência aberta (ao lado de "+ Realização").
- **Sem provedor utilizável:** se `hasUsableProvider(settings, "cv")` é falso, o diálogo abre só com o aviso "Conecte uma IA para usar o assistente" e um link para `/configuracoes`, reaproveitando `NoProviderCta` (US-05).
- **Sem perfil salvo:** os botões continuam funcionando, porque o assistente usa o **rascunho** do editor como contexto.

### D-08 — Inserir, desfazer e não persistir (RF-23, RN-21, RNF-04)
- **Inserir no perfil:** chama o `patch` do `ProfileEditor` e não grava nada no `profileStore`. O aviso de alterações não salvas da Fase 1 passa a valer.
- **Desfazer:** um toast do `sonner` traz "Texto inserido · Desfazer" por 8 s. Desfazer restaura o valor anterior do campo (ou os bullets e `highlights` anteriores).
- **Respostas da entrevista:** vivem só no estado do componente e somem ao fechar o diálogo. Um teste confere que nenhuma chave do localStorage muda até "Salvar perfil".

### D-09 — Revisar perfil (RF-27, Should): só achados determinísticos
`lib/client/profile/review.ts`, com `reviewProfile(profile): Finding[]`, sem IA:

| Achado | Regra |
|---|---|
| `bullet_no_verb` | A primeira palavra do bullet não está numa lista de verbos de ação (cerca de 60 em pt e en, como "desenvolvi", "liderei", "implementei", "reduzi", "built", "led") e não termina em -ei, -ou, -iu, -ed ou -ou-se |
| `bullet_long` | O bullet tem mais de 200 caracteres (cerca de 2 linhas no PDF) |
| `summary_long` | O resumo tem mais de 600 caracteres |
| `skill_missing` | Há stack citada nos bullets ou projetos e ausente de `skills` (vem da D-10) |

- **Onde aparece:** o botão "Revisar perfil" no topo do editor abre uma lista. Cada achado de bullet ou resumo tem "Corrigir", que abre a reescrita (D-06) no item.
- **Ruling:** os achados "com IA marcados como sugestão" ficam fora desta fase (YAGNI). As regras determinísticas cobrem os critérios do PRD, e uma chamada extra de IA aumentaria o custo sem um critério de aceite próprio.

### D-10 — Sugestão de skills (RF-28, Should)
`suggestSkills(profile): { stackId, label }[]` em `lib/client/profile/review.ts` aplica `extractStacks` aos textos dos bullets de experiência e de projetos e descarta as que já estão em `skills` (comparação por `normalizeSkill`). A sugestão aparece como chips "+ React" abaixo de `SkillChips`. O usuário aceita uma por uma, e cada aceite adiciona a skill com `years: null` e `stackId`.

### D-11 — Eval (RF-25, RNF-06)
`scripts/eval-ai` ganha o modo `--suite assist`:

- **Perfis:** usa os perfis dos 10 primeiros pares de `tests/fixtures/ai/pairs`.
- **Por perfil, roda três passos:**
  1. Perguntas para o resumo.
  2. Redação com respostas fixas e sem números.
  3. Reescrita "mais direto" do primeiro bullet.
- **O que mede:** violações do RN-20 e do RN-22 em cada saída, além do tempo. O objetivo é 0 fatos inventados em 30 gerações.
- **Modelo:** roda com o modelo padrão gratuito do OpenRouter, igual ao eval atual.
- **Teste no CI:** a suíte em modo mock (`scripts/eval-ai/mock.ts`) vira teste unitário, para provar que o harness funciona.

## 3. Segurança e privacidade
- **RNF-03:** tudo vai do navegador ao provedor do usuário. Não entra rota nova no servidor nem host novo na CSP.
- **Prompt injection:** perfil, respostas e texto atual entram via `wrapUntrusted`. A saída é sempre texto, nunca HTML, e é renderizada em `textarea` ou nós de texto.
- **PII:** o perfil é projetado sem e-mail, telefone ou endereço, e o nome vira `[NOME]`. Se `[NOME]` voltar na saída, ele é trocado pelo nome do perfil no cliente.

## 4. Testes

| Requisito | Teste |
|---|---|
| RF-24 / RN-20 | `tests/unit/client/assist-validate.test.ts`: número inventado, número por extenso, ano fora do perfil, empresa inventada, stack inventada, número presente na resposta (aceito) e tradução preservando números |
| RN-22 | Unitário do `validate` das perguntas: "Qual a sua idade?" é rejeitada e "Que produto você gosta de construir?" passa |
| RF-25 | Unitário de cada `PromptDef`: `buildUser` usa `wrapUntrusted` e não contém e-mail nem telefone. Mais o eval em modo mock |
| RF-21 / 22 / 23 | `tests/unit/client/assistant-dialog.test.tsx` com `generateStructured` mockado: fluxo de perguntas, gerar, escolher, editar e inserir; "Cancelar" aborta; reescrita com tom; desfazer |
| US-05 | Unitário: sem provedor, aparece "Conecte uma IA para usar o assistente" |
| RF-27 / 28 | `tests/unit/client/profile-review.test.ts` |
| E2E | `tests/e2e/profile-assistant.spec.ts`, com provedor falso via `page.route` (padrão de `generator.spec.ts`): (1) entrevista do resumo → inserir → aviso de não salvo → salvar; (2) "Melhorar com IA" num bullet → desfazer; (3) resposta com número inventado duas vezes → mensagem da D-04; (4) RNF-04: nenhuma chave nova no localStorage depois de fechar o painel |
| RNF-05 | No E2E: foco no primeiro campo, região `aria-live` presente e fluxo completo só por teclado. **axe:** o projeto não tem `@axe-core/playwright`, e incluir a dependência fica como pergunta em aberto (Q-F3-01) |

## 5. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| Modelos gratuitos falham no JSON estrito ou cortam a resposta | Média | Médio | `generateStructured` já trata `jsonrepair`, a folga de raciocínio e o corte. Schemas pequenos |
| O validador rejeita texto legítimo (falso positivo de nome capitalizado) | Média | Médio | Reaproveitar as isenções do validador do CV. Casos no teste unitário. A mensagem da D-04 sugere detalhar as respostas |
| Heurística de verbo de ação com falso positivo | Alta | Baixo | É só sugestão, e o usuário ignora |
| Traduzir bullets troca nomes de tecnologia | Baixa | Baixo | O prompt manda manter os termos técnicos, e o validador confere as stacks |

## 6. Perguntas em aberto
- **Q-F3-01:** incluir `@axe-core/playwright` como dependência de desenvolvimento para cumprir o "axe" do RNF-05? Sem ela, as checagens de acessibilidade ficam manuais no E2E.

## 7. Fases de entrega (tarefas do plano)
1. Validador do RN-20 sobre texto livre (D-03).
2. Prompts `profile.assist.v1` e filtro do RN-22 (D-01, D-02, D-05).
3. Serviço `lib/client/profile/assist.ts`, que encapsula as três chamadas com `generateStructured`, troca o `[NOME]` e trata as falhas da D-04.
4. `AssistantDialog`, entrevista e reescrita (D-06).
5. Botões no editor, inserir e desfazer (D-07, D-08).
6. Revisar perfil e sugestão de skills (D-09, D-10).
7. Suíte `assist` no eval (D-11).
8. E2E e verificação final.
