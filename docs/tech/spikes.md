# Spikes e avaliações

## Avaliação v1

Avaliação da geração de CV e carta (`CV_TAILOR_V1`) contra fatos inventados, JSON inválido, tempo e custo.

### Método

- 11 pares fictícios de perfil e vaga em `tests/fixtures/ai/pairs/01..11.json` (nomes inventados, e-mails `exemplo.test`, empresas imaginárias). Cobrem vagas em pt, en e es, perfis júnior a liderança, frontend, backend, mobile e dados, perfis com e sem inglês, uma descrição longa (par 04, acima do limite de 12 mil caracteres) e vagas cuja stack só combina em parte (pares 05 e 07). O par 11 foi acrescentado na revisão final da Fase 3: perfil Pleno para uma vaga Sênior, com ferramentas da vaga (Go, Kubernetes, Datadog, Grafana, Terraform) ausentes do perfil, para exercitar a cópia de senioridade e de ferramentas da vaga (no CV, a vaga não vale como fonte; só na carta). Cada par é validado com os schemas do app ao carregar.
- Cada par segue o mesmo caminho do app (`generateStructured` com o validador RN-07 na 1ª chamada, no máximo 2 chamadas, CV e carta pedidos).
- "Violação persistente" é qualquer violação do `validateTailored` ainda presente no resultado final, depois da retentativa (o app aceita a 2ª resposta e a tela só a destaca).
- Critérios de aprovação: zero violações persistentes, JSON válido nos 11 pares (eram 10; o par 11 foi acrescentado na revisão final) e p95 do tempo até 60 s.
- Custo: tokens do AI SDK convertidos em USD só quando o preço do modelo é conhecido (a lista de modelos do OpenRouter traz o preço). Sem preço, a tabela mostra os tokens e "n/d".

### Como rodar

```bash
pnpm tsx scripts/eval-ai.ts --provider openrouter              # a chave é pedida sem eco
pnpm tsx scripts/eval-ai.ts --provider openrouter --key-file ~/segredos/openrouter.key
pnpm tsx scripts/eval-ai.ts --mock                             # modelo falso, sem rede nem chave
pnpm tsx scripts/eval-ai.ts --provider openrouter --out ~/eval-cv   # também grava o texto gerado
```

- `--out <dir>` grava, para cada par que gerou documentos, `<par>-cv.txt` (o CV montado como no app, com `[REVISAR]` nos trechos que o validador marcou e a lista de violações no fim) e `<par>-carta.txt`. Serve para ler o texto que o modelo gerou, não só a contagem. O diretório precisa estar fora do repositório ou ignorado pelo git (mesma checagem do `--key-file`); sem `--out`, nada é gravado. Os pares são fictícios, mas o texto gerado não deve ir para o repositório.
- A avaliação para no primeiro par com chave inválida (`invalid_key`), sem crédito (`no_credit`), orçamento esgotado (`budget`) ou falha de rede reconhecível (sem status HTTP): os pares restantes falhariam igual. O relatório diz em que par parou, por quê e quantos não rodaram, e o resultado é REPROVADO.

- A chave nunca vem por argumento nem por variável de ambiente, e nunca é impressa. `--key-file` recusa arquivo dentro do repositório que o git não ignora.
- `--model` é opcional (padrão: o modelo de CV do provedor em `providers.ts`). `--accept-privacy` é exigido para provedores com aviso de privacidade.
- Sai com código diferente de zero se algum critério falhar.

### Validação do pipeline (`--mock`)

Isto valida o encanamento do script (fixtures, prompt, retentativa, validador, tabela, código de saída), **não avalia nenhum modelo**. O modelo falso responde fielmente ao perfil, exceto o par 07 (número inventado na 1ª chamada, corrigido na 2ª), o par 09 (JSON inválido nas 2 chamadas) e o par 11 (1ª chamada copia da vaga a senioridade "Sênior" no título e "Datadog e Grafana" num bullet; o validador rejeita e a 2ª chamada volta a ser fiel, por isso "Chamadas" = 2). Por isso o resultado "REPROVADO" é o esperado nesse modo.

```text

Par  Idioma  JSON válido  Chamadas  Violações  Tempo  Tokens (ent/saí)  Custo
---  ------  -----------  --------  ---------  -----  ----------------  -----
01   pt      sim          1         0          89 ms  921/227           n/d
02   en      sim          1         0          16 ms  948/239           n/d
03   es      sim          1         0          14 ms  913/231           n/d
04   pt      sim          1         0          26 ms  3753/226          n/d
05   en      sim          1         0          16 ms  951/246           n/d
06   pt      sim          1         0          15 ms  972/241           n/d
07   en      sim          2         0          21 ms  1892/445          n/d
08   es      sim          1         0          15 ms  876/186           n/d
09   pt      não          2         n/d        17 ms  n/d               n/d
10   en      sim          1         0          12 ms  972/251           n/d
11   pt      sim          2         0          20 ms  1898/359          n/d

Violações persistentes (total): 0
Pares sem JSON válido: 1
Tempo p50 / p95: 16 ms / 89 ms
Tokens (ent/saí): 14096/2651
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
| 11 | | | | | | |

Resumo (modelo, violações persistentes, p50/p95, custo total, aprovado/reprovado): pendente.
