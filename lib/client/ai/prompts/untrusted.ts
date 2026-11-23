import "client-only";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Id aleatório de 8 caracteres [a-z0-9], novo a cada chamada. */
function randomId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/**
 * Envolve texto não confiável (vaga, currículo) em delimitadores com id aleatório por chamada.
 * Remove do texto qualquer tag de abertura/fechamento com o mesmo nome (para o texto não "fechar" o bloco)
 * e trunca em `maxChars`. O modelo deve tratar o conteúdo como dado, nunca como instrução.
 */
export function wrapUntrusted(tag: string, text: string, maxChars: number): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Tags de abertura e fechamento, sem diferenciar caixa e com espaços (`< /cv >`).
  const delimiter = new RegExp(`<\\s*(?:/\\s*)?${escaped}(?![\\w-])[^>]*>?`, "gi");
  let clean = text.slice(0, Math.max(0, maxChars));
  // Repete até estabilizar: remover uma tag pode juntar pedaços e formar outra (`</c</cv>v>`).
  for (let prev = ""; prev !== clean; ) {
    prev = clean;
    clean = clean.replace(delimiter, "");
  }
  const id = randomId();
  return `<${tag} id="${id}">\n${clean}\n</${tag} id="${id}">`;
}
