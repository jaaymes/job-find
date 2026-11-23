# Spikes e avaliações

## Avaliação v1

Avaliação da geração de CV e carta (`CV_TAILOR_V1`) contra fatos inventados, JSON inválido, tempo e custo.

### Método

- 10 pares fictícios de perfil e vaga em `tests/fixtures/ai/pairs/01..10.json` (nomes inventados, e-mails `exemplo.test`, empresas imaginárias). Cobrem vagas em pt, en e es, perfis júnior a liderança, frontend, backend, mobile e dados, perfis com e sem inglês, uma descrição longa (par 04, acima do limite de 12 mil caracteres) e vagas cuja stack só combina em parte (pares 05 e 07). Cada par é validado com os schemas do app ao carregar.
- Cada par segue o mesmo caminho do app (`generateStructured` com o validador RN-07 na 1ª chamada, no máximo 2 chamadas, CV e carta pedidos).
- "Violação persistente" é qualquer violação do `validateTailored` ainda presente no resultado final, depois da retentativa (o app aceita a 2ª resposta e a tela só a destaca).
- Critérios de aprovação: zero violações persistentes, JSON válido nos 10 pares e p95 do tempo até 60 s.
- Custo: tokens do AI SDK convertidos em USD só quando o preço do modelo é conhecido (a lista de modelos do OpenRouter traz o preço). Sem preço, a tabela mostra os tokens e "n/d".

### Como rodar

```bash
pnpm tsx scripts/eval-ai.ts --provider openrouter              # a chave é pedida sem eco
pnpm tsx scripts/eval-ai.ts --provider openrouter --key-file ~/segredos/openrouter.key
pnpm tsx scripts/eval-ai.ts --mock                             # modelo falso, sem rede nem chave
```

- A chave nunca vem por argumento nem por variável de ambiente, e nunca é impressa. `--key-file` recusa arquivo dentro do repositório que o git não ignora.
- `--model` é opcional (padrão: o modelo de CV do provedor em `providers.ts`). `--accept-privacy` é exigido para provedores com aviso de privacidade.
- Sai com código diferente de zero se algum critério falhar.

### Validação do pipeline (`--mock`)

Isto valida o encanamento do script (fixtures, prompt, retentativa, validador, tabela, código de saída), **não avalia nenhum modelo**. O modelo falso responde fielmente ao perfil, exceto o par 07 (número inventado na 1ª chamada, corrigido na 2ª) e o par 09 (JSON inválido nas 2 chamadas). Por isso o resultado "REPROVADO" é o esperado nesse modo.

```text

Par  Idioma  JSON válido  Chamadas  Violações  Tempo  Tokens (ent/saí)  Custo
---  ------  -----------  --------  ---------  -----  ----------------  -----
01   pt      sim          1         0          78 ms  894/227           n/d
02   en      sim          1         0          22 ms  921/239           n/d
03   es      sim          1         0          18 ms  886/231           n/d
04   pt      sim          1         0          47 ms  3727/226          n/d
05   en      sim          1         0          20 ms  924/246           n/d
06   pt      sim          1         0          23 ms  945/241           n/d
07   en      sim          2         0          29 ms  1840/445          n/d
08   es      sim          1         0          11 ms  849/186           n/d
09   pt      não          2         n/d        19 ms  n/d               n/d
10   en      sim          1         0          18 ms  945/251           n/d

Violações persistentes (total): 0
Pares sem JSON válido: 1
Tempo p50 / p95: 20 ms / 78 ms
Tokens (ent/saí): 11931/2292
Custo total: n/d (sem preço conhecido para o modelo)
Resultado: REPROVADO (1 par(es) sem JSON válido)

Detalhe:
  par 09: erro invalid_output
```

### Resultado com modelo real

Pendente: executar com a chave do usuário no portão da Fase 3.

| Par | Idioma | JSON válido | Chamadas | Violações persistentes | Tempo | Custo |
| --- | ------ | ----------- | -------- | ---------------------- | ----- | ----- |
| 01 | | | | | | |
| 02 | | | | | | |
| 03 | | | | | | |
| 04 | | | | | | |
| 05 | | | | | | |
| 06 | | | | | | |
| 07 | | | | | | |
| 08 | | | | | | |
| 09 | | | | | | |
| 10 | | | | | | |

Resumo (modelo, violações persistentes, p50/p95, custo total, aprovado/reprovado): pendente.
