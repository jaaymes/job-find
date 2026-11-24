---
name: Novo provedor de IA
about: Sugerir um provedor de IA para o recurso "traga sua própria chave"
title: "provedor: "
labels: novo-provedor
---

## Provedor

- Nome:
- Documentação da API:
- Host da API (entra na CSP):

## Checklist técnico

- [ ] O provedor aceita chamadas diretas do navegador (CORS liberado para a origem do site). Descreva como verificou:
- [ ] O provedor suporta saída estruturada (JSON Schema ou equivalente). Descreva como:
- [ ] A autenticação é por chave de API enviada pelo cliente (a chave nunca passa pelo nosso servidor).
- [ ] Existe um modelo recomendado e uma estimativa de custo por uso.
- [ ] Vou adicionar a entrada em `lib/client/ai/providers.ts` e os testes correspondentes.

## Informações adicionais
