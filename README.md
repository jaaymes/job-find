# Job Find

O Job Find é uma plataforma open-source que reúne num só lugar vagas de tecnologia do Brasil e do exterior. Ele usa a **IA que você escolher** para adaptar o seu currículo a cada vaga.

> Status: em planejamento. Ainda não há código. Por enquanto, este repositório guarda o PRD, a spec técnica e o protótipo das telas.

## O que ele faz

- **Agrega vagas de tecnologia** de fontes abertas: Himalayas, boards Greenhouse/Lever/Ashby, Jobicy, repositórios de vagas no GitHub, We Work Remotely, RemoteOK, Hacker News e outras. As vagas aparecem sempre da mais nova para a mais antiga.
- **Filtra** por tecnologia (React, Angular, Vue…), por modelo de trabalho (remoto, híbrido, presencial) e por origem (nacional ou internacional). Também mostra só as vagas que aceitam quem mora no Brasil e permite filtrar por senioridade e idioma.
- **Estima sua chance**: compara o seu perfil com cada vaga e calcula a aderência no próprio navegador, sem custo.
- **Gera currículo e carta em PDF** adaptados a cada vaga, no idioma dela, sem inventar fatos que não estão no seu currículo.
- **Organiza suas candidaturas**: favoritos, vagas ocultas e status (salva, aplicada, entrevista…).

## Traga sua própria IA (BYOK)

Você conecta a IA que já usa: OpenRouter (recomendado), OpenAI, Anthropic, Google Gemini, DeepSeek, uma IA local (Ollama/LM Studio) e outras. As chamadas vão **direto do seu navegador para o provedor**, com a sua chave.

## Privacidade

Não há login. O currículo, o perfil, as chaves de IA e as candidaturas ficam **só no seu navegador** (localStorage) e nunca são enviados aos servidores do Job Find. O servidor guarda apenas o índice público de vagas.

## Documentação

- [PRD](docs/prd/2026-11-23-job-find-agregador-vagas-tech.md): problema, escopo, requisitos e métricas.
- [Spec técnica](docs/tech/2026-11-23-job-find-agregador-vagas-tech.md): arquitetura, decisões, modelo de dados e plano de entrega.

## Stack prevista

Next.js 16 (App Router) na Vercel, Postgres (Neon) com Drizzle e Vercel AI SDK no cliente. O PDF é gerado com `@react-pdf/renderer` e a interface usa Tailwind v4 e shadcn/ui.

## Contribuindo

Contribuições são bem-vindas, principalmente novas **fontes de vagas** e novos **provedores de IA**. O guia de contribuição chega junto com o primeiro código. Enquanto isso, abra uma issue com sua ideia.

## Licença

[MIT](LICENSE)
