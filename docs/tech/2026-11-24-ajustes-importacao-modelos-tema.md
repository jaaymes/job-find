# Spec técnica — Importação do CV, seletor de modelos e tema claro/escuro

- **Data:** 2026-11-24
- **Origem:** pedido do usuário na conversa (sem PRD próprio). PRD base: [docs/prd/2026-11-23-job-find-agregador-vagas-tech.md](../prd/2026-11-23-job-find-agregador-vagas-tech.md)
- **Spec base:** [docs/tech/2026-11-23-job-find-agregador-vagas-tech.md](2026-11-23-job-find-agregador-vagas-tech.md)

## 1. Requisitos (premissas registradas a partir do pedido)

| ID | Requisito |
|----|-----------|
| RF-01 | Importar o PDF de perfil exportado do LinkedIn (5 páginas, ~7 mil caracteres) sem o erro "A resposta da IA foi cortada". |
| RF-02 | Em "Modelo para cada tarefa", o campo **Modelo** permite pesquisar digitando. |
| RF-03 | A lista de modelos é ordenada do mais barato para o mais caro. |
| RF-04 | Cada modelo mostra o preço quando o **próprio provedor** informa (decisão do usuário: sem catálogo de terceiros). |
| RF-05 | Alternar entre tema claro e escuro (e seguir o sistema por padrão), com a escolha persistida. |
| Fora | Fonte LinkedIn (`jobs-guest`). Decisão do usuário em 2026-11-24: **não adicionar**, mantendo o PRD (linhas 37, 79, 345: ToS proíbe coleta automatizada). |

## 2. Diagnóstico do erro de importação (RF-01)

**Fatos:**
- Os logs do container `app` não têm erro: a extração e a chamada à IA rodam **no navegador** (`lib/client/extract`, `lib/client/ai`), então o servidor não vê nada.
- Rodei a mesma extração do pdf.js (`getDocument({ useWasm:false })` + `extractText`) no `Profile.pdf` do LinkedIn: 5 páginas, 7.231 caracteres, 0% de caracteres inválidos. **A extração funciona.**
- A mensagem vem de `components/profile/messages.ts:30` (código `truncated`), lançado em `lib/client/ai/generate.ts:144` quando o stream termina com `finishReason === "length"`.
- O teto é `maxOutputTokens: 8000` em `lib/client/ai/prompts/profile.extract.v1.ts:30`.

**Causa:** o JSON do perfil (todas as experiências, com cada bullet "fiel ao original", mais skills e formação) de um CV de 5 páginas chega perto dos 8 mil tokens. Nos modelos com raciocínio (padrões do projeto: `gpt-5-mini`, `gemini-2.5-flash`, `deepseek-v4.1-flash` via OpenRouter), os tokens de reasoning **contam no mesmo `maxOutputTokens`**, e o teto estoura antes do JSON terminar. Premissa: não sei qual modelo você usou. A correção cobre todos.

## 3. Decisões

### D-01 — Orçamento de saída da extração (RF-01)
- **Opções:** (a) só subir o teto; (b) subir o teto e limitar o raciocínio por provedor; (c) dividir o CV em blocos e montar o perfil por partes.
- **Decisão:** (b). Subir `PROFILE_EXTRACT_V1.maxOutputTokens` para **16000** e, em `providerOptions()` (`generate.ts:43`), mandar esforço de raciocínio mínimo para as tarefas `extract` (extração não precisa de raciocínio): OpenAI `reasoningEffort: "minimal"`, Google `thinkingConfig.thinkingBudget: 0` (Flash) / baixo, xAI e OpenRouter `effort: "low"` (o OpenRouter já tem). Anthropic não liga raciocínio por padrão, então fica como está.
- **Por que não (c):** custa 2 a 3 vezes mais chamadas e exige mesclar as partes. Só vale se (b) não bastar.
- **Consequências:** custo por importação continua baixo (tokens só são cobrados quando usados). Atualizar `USAGE.extract.tokensOut` em `components/settings/cost.ts` de 1500 para ~3000, que é mais realista. Ajustar a mensagem `truncated` do perfil para sugerir trocar de modelo.
- **Teste:** unit em `generate` confirmando os `providerOptions` por provedor/tarefa; contrato do prompt com o novo teto.

### D-02 — Campo Modelo pesquisável (RF-02)
- **Opções:** (a) `<input list>` + `<datalist>` nativo; (b) `Combobox` do `@base-ui/react` (já é dependência, mesma família do `components/ui/select.tsx`); (c) nova lib (cmdk, react-select).
- **Decisão:** (b). Criar `components/ui/combobox.tsx` no padrão shadcn/Base UI e usar só no campo **Modelo** do `TaskModelRow`. O campo **Provedor** continua `<select>` nativo (lista curta, até 14 itens).
- **Por que não (a):** o datalist não deixa mostrar o preço formatado, a ordem nem "(recomendado)" de forma consistente entre navegadores. **Por que não (c):** dependência nova sem ganho.
- **Acessibilidade:** o Base UI já entrega `role="combobox"`, teclado e `aria-activedescendant`; manter o `<label htmlFor>` atual. Filtro por id e por rótulo, sem diferenciar maiúsculas/acentos.

### D-03 — Ordenação e preço (RF-03, RF-04)
- **Preço:** só o do próprio provedor, no `listModels` de cada um:
  - OpenRouter: já vem (`pricing.prompt/completion`).
  - Together AI: o `GET /v1/models` traz `pricing.input/output` (USD/1M). Ler. *Premissa a verificar no teste de contrato.*
  - Vercel AI Gateway: o `GET /v1/models` traz `pricing.input/output` (USD por token). Ler. *Premissa a verificar.*
  - IA local: preço 0 ("grátis").
  - Demais (OpenAI, Anthropic, Google, Mistral, DeepSeek, Groq, Cerebras, xAI, Fireworks, Hugging Face): a API não informa preço, então mostram "sem preço".
- **Ordem:** função pura `sortModelsByCost(task, models)` em `components/settings/cost.ts`, que ordena pelo custo estimado da operação (`tokensIn·priceIn + tokensOut·priceOut`, a mesma conta do `estimateCost`). Grátis primeiro, depois do mais barato ao mais caro. Modelos sem preço ficam no fim, em ordem alfabética. Empate por rótulo.
- **Exibição no item:** `rótulo · ≈ US$ 0,0021 por currículo` (ou "grátis" / "sem preço"). "(recomendado)" continua como selo.
- **Teste:** unit de `sortModelsByCost` (grátis, sem preço, empate) e do parse de preço do Together/Gateway com fixtures.

### D-04 — Tema claro/escuro (RF-05)
- **Fatos:** a paleta `jf-*` (250 usos) é hex fixo em `@theme` (`app/globals.css:51-71`). Há 8 cores fixas fora dos tokens (`JobsPage.tsx:267`, `AiAnalysis.tsx:62`, `ProviderCard.tsx:111`, `TailoredEditor.tsx:48`, `GeneratorScreen.tsx:385`, `ReviewBanner.tsx:5`, `ImportPanel.tsx:119`). O `next-themes` está instalado, mas só o `sonner.tsx` o usa, e não há `ThemeProvider`.
- **Problema de CSP:** o `next-themes` injeta um `<script>` inline para evitar o flash de tema errado. Nas rotas `(local)` a CSP é nonce + `'strict-dynamic'` (`proxy.ts`), e passar o nonce ao layout raiz exigiria `headers()`, o que deixaria **todas** as páginas dinâmicas (vai contra a D-15).
- **Opções:** (a) `next-themes` com o script bloqueado nas rotas `(local)` (flash + violação de CSP no console); (b) script inline próprio, de conteúdo fixo, com o **hash sha256 dele na CSP** (hash vale mesmo com `'strict-dynamic'`), e um provider mínimo próprio; (c) tema só via cookie no servidor (deixa as páginas dinâmicas).
- **Decisão:** (b). `lib/client/theme/` com `THEME_SCRIPT` (constante exportada), `ThemeProvider` + `useTheme()` (claro / escuro / sistema, `localStorage` com try/catch, classe `.dark` no `<html>`, `color-scheme`). `lib/shared/csp.ts` calcula o hash dessa mesma constante e o inclui nas duas CSPs, então a constante e o hash nunca divergem. O `sonner.tsx` passa a usar o hook próprio, e o `next-themes` sai das dependências.
- **Paleta:** mover os `--color-jf-*` para variáveis em `:root` com versão `.dark` (fundo ~#121418, superfície ~#1b1e24, tinta ~#eceae5, marca clareada para contraste AA) e trocar as 8 cores fixas por tokens. O PDF do CV (`lib/client/pdf/*`) **não** muda: o documento continua claro.
- **Toggle:** botão no `SiteHeader` (ícones `Sun`/`Moon` do lucide, que já é dependência) que alterna claro↔escuro. A primeira visita segue o sistema. `aria-label` e `aria-pressed`.
- **Teste:** unit do provider (persistência, `prefers-color-scheme`, `localStorage` indisponível); unit da CSP confirmando que o hash bate com `THEME_SCRIPT`; e2e (Playwright) alternando o tema sem violação de CSP nas rotas pública e `(local)`.

## 4. Eixos sem impacto
Dados/migrações, APIs do servidor, coleta (o LinkedIn ficou fora) e multi-tenant: sem impacto. Segurança: apenas a mudança de CSP da D-04, que libera um único script inline por hash e não abre `'unsafe-inline'` nas rotas `(local)`.

## 5. Plano em fases

| Fase | Entrega | Arquivos | Esforço |
|------|---------|----------|---------|
| 1 | Correção da importação (D-01) | `prompts/profile.extract.v1.ts`, `ai/generate.ts`, `settings/cost.ts`, `profile/messages.ts`, testes | P |
| 2 | Modelo pesquisável + ordenação + preço (D-02, D-03) | `ui/combobox.tsx`, `settings/TaskModelRow.tsx`, `settings/cost.ts`, `ai/providers.ts`, testes | M |
| 3 | Tema claro/escuro (D-04) | `globals.css`, `lib/client/theme/*`, `app/layout.tsx`, `app/providers.tsx`, `shared/csp.ts`, `layout/SiteHeader.tsx`, `ui/sonner.tsx`, 7 componentes com cor fixa, testes | M |

As fases 1, 2 e 3 são independentes (arquivos disjuntos, exceto `cost.ts` entre 1 e 2, que fica em sequência). A fase 1 é a primeira porque destrava o uso.

## 6. Riscos

| Risco | Prob. | Impacto | Mitigação |
|-------|-------|---------|-----------|
| Modelo escolhido ignora o parâmetro de raciocínio e ainda trunca | Média | Médio | Teto de 16k; se persistir, D-01 (c) como evolução |
| Formato de preço do Together/Gateway diferente do esperado | Média | Baixo | Parse tolerante (Zod `safeParse`): sem preço em vez de quebrar |
| Contraste ruim de alguma combinação no escuro | Média | Baixo | Conferir AA nos pares tinta/fundo e nos badges |
| Hash da CSP divergir do script | Baixa | Alto (flash/console) | Hash calculado da mesma constante + teste unitário |

## 7. Perguntas em aberto
- Qual modelo você usou na importação que falhou? Isso ajuda a validar a D-01 de ponta a ponta.

## Histórico
- 2026-11-24: criação. Decisões do usuário: LinkedIn fora; preço só do próprio provedor.
- 2026-11-24: plano em [docs/plans/2026-11-24-ajustes-importacao-modelos-tema.md](../plans/2026-11-24-ajustes-importacao-modelos-tema.md). Ajustes da D-01: OpenAI `reasoningEffort: "low"` (o `"minimal"` não vale nos o-series), Google `thinkingBudget: 128` (o 2.5 Pro rejeita 0), sem opção para o xAI. Ajuste da D-04: o hash do script de tema vai só na CSP com nonce, porque na CSP pública ele anularia o `'unsafe-inline'`.
