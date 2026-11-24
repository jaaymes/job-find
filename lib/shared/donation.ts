/**
 * Canais de doação do Job Find (página /apoie). Ficam no código, sem variável de ambiente:
 * quem roda a própria instância troca aqui.
 */

/** Chave aleatória (EVP): não expõe CPF, telefone nem e-mail do mantenedor. */
export const PIX = {
  key: "23a9d09e-63da-48f0-b7e5-bbf0e68962d6",
  name: "Job Find",
  city: "Brasil",
} as const;

export const GITHUB_SPONSORS_URL = "https://github.com/sponsors/jaaymes";
