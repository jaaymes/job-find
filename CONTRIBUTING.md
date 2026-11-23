# Contribuindo com o Job Find

Obrigado por querer ajudar! Este guia explica como rodar o projeto e como adicionar fontes de vagas e provedores de IA. Ao participar, você concorda com o nosso [Código de Conduta](CODE_OF_CONDUCT.md).

## Rodando localmente

Requisitos: Node 24, pnpm e Docker (usado só para o banco dos testes de integração).

```bash
pnpm i
cp .env.example .env.local   # preencha só o que for usar
pnpm dev                      # http://localhost:3000
```

Comandos úteis:

| Comando | O que faz |
| --- | --- |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Checagem de tipos (`tsc --noEmit`) |
| `pnpm test` | Testes unitários (Vitest, projeto `unit`) |
| `pnpm db:test:up` | Sobe o Postgres de teste (porta 54329) |
| `pnpm test:integration` | Testes de integração contra o Postgres de teste |
| `pnpm test:e2e` | Testes ponta a ponta (Playwright) |
| `pnpm build` | Build de produção |

O banco de teste usa a URL fixa `postgres://postgres:postgres@127.0.0.1:54329/jobfind_test`; não é preciso configurar variável de ambiente.

Antes de abrir um PR, rode `pnpm lint && pnpm typecheck && pnpm test`. Não crie variáveis de ambiente nem feature flags sem discutir antes em uma issue.

## Adicionar uma fonte de vagas

1. Abra uma issue com o modelo "Nova fonte de vagas" e preencha o checklist de Termos de Uso.
2. Registre a checagem de ToS da fonte em `docs/fontes.md` (termos, robots.txt, limites, atribuição).
3. Implemente a interface `Connector` (definida na Tarefa 10 do plano) em um novo conector, seguindo os existentes.
4. Adicione fixtures com respostas reais (anonimizadas, se preciso) em `tests/fixtures/sources/<id>/` e escreva testes que usem essas fixtures, sem chamar a rede.
5. Abra o PR usando o modelo e marque "Nova fonte de vagas".

## Adicionar um provedor de IA

1. Abra uma issue com o modelo "Novo provedor de IA" e confirme CORS para chamadas do navegador e suporte a saída estruturada.
2. Adicione a entrada do provedor em `lib/client/ai/providers.ts` (criado na Tarefa 23 do plano). O host da API é incluído automaticamente na CSP.
3. Cubra o novo provedor com testes unitários.
4. Abra o PR usando o modelo e marque "Novo provedor de IA".

## Commits e PRs

Usamos mensagens no estilo Conventional Commits em português (`feat:`, `fix:`, `docs:`, `chore:`). Mantenha PRs pequenos e focados, e inclua testes junto com a mudança.
