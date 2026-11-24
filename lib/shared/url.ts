const MAX_URL_LENGTH = 2048;

/**
 * Valida e normaliza uma URL vinda de fontes externas (SEC-03).
 *
 * Aceita apenas `https:` (e `http:` quando `allowHttp` é true), rejeita URLs
 * com credenciais e limita o tamanho do texto já aparado. Devolve a URL
 * normalizada via `URL.toString()` ou `null` quando inválida.
 */
export function safeUrl(input: string, opts?: { allowHttp?: boolean }): string | null {
  const trimmed = input.trim();
  if (trimmed.length > MAX_URL_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const allowed = opts?.allowHttp ? ["https:", "http:"] : ["https:"];
  if (!allowed.includes(url.protocol)) return null;
  if (url.username !== "" || url.password !== "") return null;

  return url.toString();
}
