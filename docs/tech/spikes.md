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

## S-3: Getro (2026-11-24)

Pergunta da spec (S-3, D-07): os job boards de VCs brasileiras (Kaszek, monashees, Canary) rodam no Getro e têm API ou feed público, com termos que permitam coleta automática? Regras em jogo: RN-09 (termos checados e datados antes de ir a produção) e a regra de serviços externos só se gratuitos para o uso real do projeto.

**Veredito: não viável.** Um dos três boards não usa Getro, outro saiu do ar, o terceiro não foi localizado; e a única API do Getro que alimenta boards públicos é proibida pelo `robots.txt` e pelos Termos. A API oficial é paga e sob gestão da rede (VC), sem acesso para terceiros.

### Método

- Poucas requisições `curl` (cerca de 40, espaçadas de 1 a 2 s), com user agent genérico (`Mozilla/5.0 (compatible; JobFindSpike/1.0)`), sem login, sem credenciais e sem contornar proteção. Resolução de DNS com `dig` contra 8.8.8.8.
- Leitura do HTML de cada board, de `robots.txt`, dos Termos do Getro e dos Termos do Consider, mais busca web por documentação.
- Nenhuma requisição foi feita contra `api.getro.com` (o `robots.txt` o proíbe). O formato do endpoint não oficial vem de terceiros e não foi reproduzido.

### Achados por board

| Board | O que foi encontrado (2026-11-24) |
|---|---|
| Kaszek (`jobs.kaszek.com`) | **Não é Getro: é Consider** (CNAME `boards.consider.com`, rodapé "Powered by Consider"). `GET /jobs` devolve 200 (17,8 KB) e `robots.txt` permite tudo (`User-agent: *`, `Allow: /`; só o LinkedInBot é bloqueado). O HTML embute `numJobs: 977` e `numCompanies: 82`, mas a lista de vagas é carregada por uma API interna (`POST /api-boards/search-jobs`), que respondeu **HTTP 412 `INVALID_CSRF`** sem sessão do navegador. `/sitemap.xml` devolve 404. Não há feed RSS nem JSON público |
| monashees | `jobs.monashees.com.br` (endereço que a busca web mostra) **não resolve em DNS** hoje (sem registro A nem CNAME); `jobs.monashees.com` também não. Os slugs `monashees.getro.com` e `monashees-capital.getro.com` devolvem 404. O board parece desativado ou migrado. Não foi possível medir nada |
| Canary | Nenhum board localizado: `jobs.canary.com.br`, `jobs.canary.vc` e `jobs.canary.com` não resolvem; `canary.getro.com` e `canary-ventures.getro.com` dão 404; o site `canary.com.br` (200) não linka para nenhum board de vagas, e a busca web não achou board nem Getro. Não foi possível medir nada |
| Outras VCs BR/LatAm (checagem barata de DNS, 17 hosts `jobs.<vc>`: Redpoint, Valor, Astella, NXTP, Maya, Kviv, Yellow, Latitud, Dila, Mouro, Bossa Nova, Wayra, IGAH, Upload e outros) | Nenhum aponta para o Getro (IPs `18.213.60.21`/`3.94.157.207`, ou `ns01.prod.getro.com`). Lista não exaustiva |

### Endpoints do Getro

| Endpoint | Status / situação | Observação |
|---|---|---|
| `POST https://api.getro.com/api/v2/collections/{id}/search/jobs` (não oficial) | Não chamado. Descrito em terceiros ([issue 140 do Kestrelapp](https://github.com/distantsoil/Kestrelapp/issues/140), verificada pelo autor em 2026-11-03) | `id` vem de `__NEXT_DATA__` (`props.pageProps.network.id`) da página `/jobs` do board; exige `Referer` do próprio board (sem ele, 406); corpo `{"hitsPerPage":N,"page":P,"filters":{"page":P},"query":""}`; itens com `id`, `title`, `url`, `created_at` (epoch), `locations`, `organization`, `seniority`, `skills`, `work_mode`, `source`, `compensation_*`; sem descrição completa (só `has_description`). O mesmo autor fechou o pedido de suporte "como não planejado" porque o `robots.txt` do serviço proíbe acesso automatizado |
| Getro API oficial (["Network API"](https://www.getro.com/api)) | Página de marketing (200); documentação só pelo link "API Docs" | Voltada ao administrador da rede (contatos, vagas, empresas), "acesso gerenciado", pensada para integração de backend com atualização a cada 6 h; vendida junto de plano e demonstração ("Get a Demo", página de preços). Não há chave nem plano gratuito para terceiros |
| Feed RSS/JSON público por board | Não encontrado | O `robots.txt` do board de exemplo (`jobs.pointnine.com`, 200) só libera alguns bots e cita sitemap; não há feed |

### Robots e termos (checados em 2026-11-24)

- [`https://api.getro.com/robots.txt`](https://api.getro.com/robots.txt): 200, `User-agent: *` com `Disallow: /`. Todo acesso automatizado à API é vetado.
- [`https://www.getro.com/robots.txt`](https://www.getro.com/robots.txt): 200, só `Disallow: /thank-you`. Boards individuais variam (`jobs.pointnine.com`: `Crawl-delay: 10` para alguns bots).
- [Termos de Uso do Getro](https://www.getro.com/terms) (versão 3.1, atualizada em junho de 2025): cobrem o site, as APIs de clientes e "qualquer job board operado pelo Getro", e proíbem "crawl", "scrape" ou "spider" de qualquer página, dado ou conteúdo, "por meio manual ou automatizado". Sem permissão por escrito, a coleta violaria os termos.
- [Termos do Consider](https://consider.com/legal/terms) (plataforma do Kaszek): proíbem "robot, spider, scraper ou outro meio automatizado" para acessar o serviço sem permissão expressa por escrito, e contornar medidas de restrição de acesso (o 412 `INVALID_CSRF` é uma delas).
- Os termos de cada VC (Kaszek, monashees, Canary) não foram lidos: sem sentido ler, porque a plataforma já veda o acesso.

### Volume e sobreposição

- Kaszek: 977 vagas em 82 empresas (número do próprio HTML, todas as áreas). Não foi possível medir quantas são tech, nem quantas no Brasil ou remoto LatAm, porque a lista só sai pela API interna protegida.
- monashees e Canary: 0 medidas (sem board acessível).
- Referência de terceiros: um board Getro grande (Point Nine) tinha 1.414 vagas em 2026-11-03, com `url` frequentemente apontando para o ATS da empresa (exemplo citado: Ashby).
- Estimativa de sobreposição (qualitativa, não medida): como esses boards agregam vagas dos ATS das empresas da carteira (Greenhouse, Lever, Ashby), a maior parte do que haveria de tech ficaria duplicada com as fontes que já coletamos direto. O ganho real seria só descobrir slugs de ATS de startups BR ainda fora das listas de boards curados, o que pode ser feito manualmente, sem a plataforma.

### Conector proposto

Nenhum. Nada a implementar: sem API pública gratuita, sem feed, e com `robots.txt` e Termos que proíbem coleta automatizada (Getro e Consider). O endpoint não oficial do Getro foi apenas registrado e não é recomendado.

### Alternativas baratas

- Usar os boards das VCs só como fonte de **descoberta manual** de empresas: olhar a carteira (por exemplo as 82 empresas do Kaszek), achar o slug do ATS de cada uma e acrescentar às listas de `GREENHOUSE_BOARDS`, `ASHBY_BOARDS`, `LEVER_BOARDS` ou `SMARTRECRUITERS_BOARDS` (fontes cujo acesso já está registrado em `docs/fontes.md`). Isso não envolve coletar o Getro nem o Consider.
- Reavaliar se o Getro ou as VCs oferecerem feed público ou autorização por escrito (a decisão e a gestão dessa conversa ficam com o usuário).
