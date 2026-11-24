# Spec técnica: modal de progresso da importação do CV

- **Data:** 2026-11-24
- **Origem:** pedido do usuário na conversa (sem PRD próprio): "ao importar o CV mostre um modal com a porcentagem da importação e da consulta à IA, algo mais visível para o usuário".
- **Spec relacionada:** [2026-11-24-ajustes-importacao-modelos-tema.md](2026-11-24-ajustes-importacao-modelos-tema.md) (D-01, orçamento de saída da extração)

## 1. Requisitos (premissas registradas a partir do pedido)

| ID | Requisito |
|----|-----------|
| RF-01 | Ao importar um CV (arquivo ou texto colado), abrir um modal que mostra em que etapa a importação está: ler o arquivo, consultar a IA e conferir o resultado. |
| RF-02 | O modal mostra uma porcentagem e uma barra que **nunca voltam** e só chegam a 100% quando o perfil está pronto. |
| RF-03 | O modal mostra o que a IA já encontrou enquanto responde (ex.: "3 experiências · 14 competências"), para o avanço parecer real. |
| RF-04 | Dá para cancelar pelo modal (botão, Esc ou X; clique fora não cancela), com o mesmo efeito do "Cancelar" de hoje. |
| RNF-01 | Acessível: `role="progressbar"` com `aria-valuenow`, título e descrição ligados ao diálogo, foco preso no modal, a etapa anunciada (sem anunciar cada %), e respeito a `prefers-reduced-motion`. |
| RNF-02 | Sem dependência nova e sem custo extra de IA (nenhuma chamada a mais). |

## 2. Como funciona hoje (fatos)

- `components/profile/ImportPanel.tsx:23`: `status` é `"idle" | "reading" | "analyzing"`, e o aviso é uma linha de texto pequena com `role="status"` dentro do card (`ImportPanel.tsx:179-191`). É isso que passa despercebido.
- A leitura roda num Web Worker (`lib/client/extract/index.ts`) que só responde no fim: não há progresso por página. Ela costuma levar 1–2 s.
- A IA é chamada por `importProfile` (`lib/client/profile/import.ts:23`) → `generateStructured` (`lib/client/ai/generate.ts`), que **já faz streaming** e aceita `onPartial` (`generate.ts:35`, emitido no máximo a cada 50 ms, `generate.ts:150-156`). O gerador de CV já usa isso (`components/generator/GeneratorScreen.tsx:191`). A importação ainda não usa.
- Em modelos com raciocínio, os primeiros segundos não trazem texto nenhum (o raciocínio vem com `exclude: true` no OpenRouter, `generate.ts:72`). Pode haver uma 2ª chamada (retentativa por corte ou JSON inválido, `generate.ts:198-232`).
- `components/ui/dialog.tsx` (Base UI) já existe e é usado em `OnboardingGuide.tsx:123` e `PrivacyConsentDialog.tsx:20`.

**Consequência:** não existe um "total" conhecido da resposta da IA. Uma porcentagem exata é impossível; ela precisa ser **estimada**, e o texto do modal deve deixar isso honesto ("cerca de").

## 3. Decisões

### D-01: Como calcular a porcentagem (RF-02)
- **Opções:**
  - (a) Barra indeterminada (animação sem número). Honesta, mas não atende o pedido de porcentagem.
  - (b) Porcentagem só por tempo (curva que se aproxima de 95%). Simples, mas desligada do que acontece de fato.
  - (c) **Etapas com peso, e dentro da etapa da IA, o tamanho da resposta já recebida comparado a uma estimativa do tamanho final.**
- **Decisão:** (c), com faixas fixas por etapa:

  | Etapa | Faixa | Como avança dentro da faixa |
  |-------|-------|------------------------------|
  | Lendo o arquivo | 0 → 15% | Curva por tempo (o worker não informa progresso). Texto colado começa direto em 15%. |
  | IA analisando (antes do 1º trecho) | 15 → 30% | Curva por tempo (`1 - e^(-t/τ)`, τ ≈ 8 s), sem nunca chegar a 30%. Cobre o raciocínio e a latência. |
  | IA respondendo | 30 → 95% | `caracteres_recebidos / estimativa`, limitado a 95%. Estimativa = `clamp(tamanho_do_texto_do_CV × 1,2; 1.500; 40.000)`. |
  | Conferindo | 95 → 100% | Validação, montagem do perfil. Vai a 100% ao chamar `onImported`. |

- O valor mostrado é sempre `max(anterior, novo)`: **nunca volta**. Numa retentativa a barra para onde está e o texto muda para "A IA está revisando a resposta...".
- O tamanho recebido vem do JSON parcial do `onPartial` (`JSON.stringify(parcial).length`), então não muda nada no `generate.ts`.
- **Premissa:** o fator 1,2 (JSON ≈ 1,2× o texto do CV) é um chute inicial. Na Fase 1 calibro com o `Profile.pdf` do LinkedIn que já foi usado na spec anterior e com uma fixture de teste. Se errar para baixo, a barra fica parada em 95% por mais tempo (aceitável). Se errar para cima, ela pula para 100% no fim (também aceitável).
- **Por que não (b):** com o streaming já disponível, ligar a barra ao texto real custa pouco e é mais confiável.
- **Onde fica:** uma função pura `importProgress(state, now)` em `lib/client/profile/import-progress.ts`, sem React, fácil de testar com relógio falso.

### D-02: Resumo do que a IA já encontrou (RF-03)
- Do parcial: quantas `experiences`, `skills` e `education` já existem, mais o `name`/`headline` se vierem. Linha no modal: "Encontrado até agora: 3 experiências · 14 competências · 1 formação".
- Só mostra contagens e o cargo, nunca o texto dos bullets (é parcial e pode estar cortado no meio da palavra).
- O parcial é `unknown`: lido com guardas (`Array.isArray`), sem confiar no formato.

### D-03: Componente do modal (RF-01, RF-04, RNF-01)
- **Opções:** (a) aumentar o aviso inline do card; (b) `Dialog` do Base UI que já existe; (c) toast do `sonner`.
- **Decisão:** (b). Novo `components/profile/ImportProgressDialog.tsx`, controlado pelo `ImportPanel` (aberto enquanto `status !== "idle"`). Conteúdo: título "Importando seu currículo", lista das 3 etapas com marcação de concluída/atual/pendente, barra com `role="progressbar"` + `aria-valuenow/min/max` + `aria-valuetext="cerca de 42%, IA respondendo"`, o número grande ("42%"), a linha do D-02, e o botão "Cancelar".
- Fechar pelo X ou por Esc = **cancelar** a importação (mesmo código do botão de hoje, `ImportPanel.tsx:183-187`). Clique fora **não** fecha (`disablePointerDismissal`), para ninguém perder uma importação de 20 s por um clique sem querer.
- Anúncio para leitor de tela: só a **troca de etapa** vai para uma região `aria-live="polite"`. A porcentagem fica na `progressbar`, que o leitor lê quando o usuário chega nela.
- `prefers-reduced-motion`: a barra sem transição animada.
- **Por que não (a):** é o que existe hoje e é justamente o que não foi visto. **Por que não (c):** o toast é pequeno e some.
- **Erro:** o modal fecha e o erro continua no alerta do card (`ImportPanel.tsx:192-200`), onde já estão o "Tentar de novo" e o campo de colar texto. Assim o fluxo de PDF escaneado (que abre o campo de colar) não muda.
- **Sucesso:** o modal fecha logo, antes do `onImported`, para não empilhar com a confirmação de substituição do `ProfileScreen`. Os campos do perfil aparecem como hoje.

### D-04: Mudança no contrato de `importProfile`
- Adicionar um parâmetro opcional `onPartial?: (p: unknown) => void`, repassado ao `generateStructured`. É compatível com quem já chama (só o `ImportPanel`).
- **Retentativa:** para mudar o texto para "revisando", o `generateStructured` precisaria avisar que começou a 2ª chamada. **Decisão:** não mexer no `generate.ts` agora. A retentativa aparece como a barra parada perto de 95%. Se incomodar, um `onAttempt` opcional é uma evolução pequena.

## 4. Eixos sem impacto
Dados e migrações, APIs do servidor, CSP, integrações e custo de IA: sem impacto (zero chamadas a mais, e tudo roda no navegador como hoje). Segurança: o parcial da IA é tratado como dado e renderizado só como texto/números pelo React. Nenhum HTML vem do modelo.

**Especialistas:** a mudança é pequena e fica em 3 arquivos de front, com padrões que já existem no projeto (`Dialog`, `onPartial`). Por isso não convoquei subagentes. Acessibilidade e testes estão cobertos acima.

## 5. Testes
- **Unit `import-progress`** (relógio falso): faixas de cada etapa, nunca volta, limite de 95% sem o fim, 100% só no final, texto colado começando em 15%, estimativa com CV muito curto e muito longo.
- **Unit `ImportPanel`** (`tests/unit/client/import-panel.test.tsx`, que já faz mock de `extractText`/`importProfile`): o modal abre ao escolher o arquivo, mostra a etapa "Lendo", passa para "IA" e mostra as contagens quando o mock chama `onPartial`, o Cancelar/Esc aborta e fecha, o erro fecha o modal e aparece no card, o PDF escaneado fecha o modal e abre o campo de colar.
- **E2E** (`tests/e2e/profile.spec.ts`): ajustar o fluxo de importação para esperar o diálogo e o fim dele.

## 6. Plano em fases

| Fase | Entrega | Arquivos | Esforço |
|------|---------|----------|---------|
| 1 | Cálculo do progresso + `onPartial` na importação (D-01, D-02, D-04) | `lib/client/profile/import-progress.ts` (novo), `lib/client/profile/import.ts`, testes unit | P |
| 2 | Modal e integração no painel (D-03) | `components/profile/ImportProgressDialog.tsx` (novo), `components/profile/ImportPanel.tsx`, `tests/unit/client/import-panel.test.tsx`, `tests/e2e/profile.spec.ts` | M |

A Fase 2 depende da 1 (consome a função de progresso). O caminho crítico é curto: P + M.

## 7. Riscos

| Risco | Prob. | Impacto | Mitigação |
|-------|-------|---------|-----------|
| Estimativa do tamanho erra muito e a barra fica parada em 95% | Média | Baixo | Calibrar na Fase 1 com o PDF real; o texto diz "cerca de" |
| Modelo com raciocínio longo deixa a barra devagar entre 15 e 30% | Alta | Baixo | Curva por tempo nessa faixa + texto "A IA está analisando seu currículo" |
| Re-render a cada parcial pesar | Baixa | Baixo | O `onPartial` já vem limitado a 50 ms; só guardo tamanho e contagens no estado |

## Histórico
- 2026-11-24: criação.
- 2026-11-24: plano em [docs/plans/2026-11-24-modal-progresso-importacao.md](../plans/2026-11-24-modal-progresso-importacao.md). Ajuste: sem o "Pronto!" de 400 ms no sucesso (empilharia com a confirmação de substituição).
