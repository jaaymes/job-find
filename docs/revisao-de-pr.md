# Revisão de PR por IA

O Job Find tem um agente que revisa pull requests da comunidade antes do merge. Ele olha três coisas:

- **Segurança:** segredos, código ofuscado ou malicioso, injeção (SQL, XSS, SSRF), dependências suspeitas, mudanças em CI e as invariantes do projeto (privacidade local, BYOK, CSP, autenticação do cron, sanitização de HTML, `allowedHosts` dos conectores).
- **Veracidade:** se o código faz o que o título, a descrição e o checklist do PR dizem, se as APIs usadas existem e se os testes testam algo de verdade.
- **Aderência ao projeto:** escopo do produto, regras do [CONTRIBUTING](../CONTRIBUTING.md), termos de uso das fontes em [docs/fontes.md](fontes.md), licença e Conventional Commits.

As instruções do agente ficam em [`.claude/agents/pr-reviewer.md`](../.claude/agents/pr-reviewer.md). Para mudar o que ele verifica, edite esse arquivo (a mudança só vale depois de entrar na `main`).

A revisão é um apoio: ela **não aprova nem faz merge**, e o merge continua dependendo de revisão humana.

## Como pedir uma revisão

No PR, aplique o label **`ia-review`**. O workflow [`ia-review.yml`](../.github/workflows/ia-review.yml) roda, publica comentários inline nos problemas e um comentário de resumo com o veredito, e remove o label no fim. Para revisar de novo depois de novos commits, aplique o label outra vez.

Só quem tem acesso de escrita ao repositório consegue aplicar labels, então quem abre o PR não dispara a revisão (nem gasta créditos) sozinho.

## Configuração (uma vez, pelo mantenedor)

1. **Chave da API:** em *Settings → Secrets and variables → Actions*, crie o secret `ANTHROPIC_API_KEY`. Quem usa assinatura do Claude pode trocar por um token gerado com `claude setup-token`, salvo como `CLAUDE_CODE_OAUTH_TOKEN` (e, no workflow, trocar `anthropic_api_key` por `claude_code_oauth_token`).
2. **Label:** crie o label `ia-review` em *Issues → Labels*.
3. **Actions:** em *Settings → Actions → General*:
   - *Fork pull request workflows from outside collaborators*: **Require approval for all external contributors**.
   - *Workflow permissions*: **Read repository contents and packages permissions** e desmarque **Allow GitHub Actions to create and approve pull requests**.
4. **Proteção da `main`:** em *Settings → Branches* (ou *Rules*), exija ao menos 1 aprovação humana e o check do CI antes do merge. Não marque a revisão por IA como check obrigatório.

## Por que é seguro rodar em PR de fork

O workflow usa `pull_request_target`, que roda com os segredos do repositório. Para isso não virar porta de entrada:

- O workflow, as instruções do agente e a configuração do Claude vêm sempre da `main`; o PR não consegue alterá-los para a própria revisão.
- O código do PR é baixado em `pr-head/` só para leitura. Nenhum passo instala dependências, roda testes ou executa scripts dele.
- O agente só tem ferramentas de leitura (`Read`, `Grep`, `Glob`, `gh pr view`, `gh pr diff`) e de comentário. Não edita arquivos, não acessa a web, não aprova e não faz merge.
- O agente trata todo o conteúdo do PR como dado. Um texto que tente dar ordens a ele (injeção de prompt) é reportado como achado bloqueante.

Mesmo assim, leia a revisão como uma segunda opinião: um PR malicioso pode tentar enganar o agente, e o que ele não consegue confirmar (termos de uso, comportamento em produção) vem listado em "Para o mantenedor verificar manualmente".

## Uso local

Com o [Claude Code](https://code.claude.com) no repositório e o `gh` autenticado, peça: "use o agente pr-reviewer para revisar o PR 42". Ele segue as mesmas instruções e devolve o resumo no terminal.
