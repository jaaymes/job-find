/** Hosts aceitos em http (só desenvolvimento local), sempre com porta explícita. */
const LOCAL_HTTP = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

/**
 * Origem pública do app a partir da própria requisição (na Vercel, `req.url` já traz o host público).
 * Só aceita https, ou http em localhost/127.0.0.1 com porta; qualquer outra coisa devolve null.
 */
export function cimdOrigin(req: Request): string | null {
  let origin: string;
  try {
    origin = new URL(req.url).origin;
  } catch {
    return null;
  }
  if (origin.startsWith("https://") || LOCAL_HTTP.test(origin)) return origin;
  return null;
}
