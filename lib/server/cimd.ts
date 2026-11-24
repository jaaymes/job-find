/** Hosts locais aceitos em http (só desenvolvimento), sempre com porta explícita. */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1):\d+$/;

const first = (value: string | null): string | null => {
  const v = value?.split(",")[0]?.trim();
  return v ? v : null;
};

/**
 * Origem pública do app. Atrás de proxy/túnel o `req.url` traz o host local, então o host vem de
 * `x-forwarded-host`, depois `host`, por último de `req.url`. O protocolo é https, exceto em
 * localhost/127.0.0.1 com porta (usa `x-forwarded-proto` se for https, senão o de `req.url`).
 * Devolve null para host malformado, IPv6 literal ou qualquer origem http fora do localhost.
 */
export function cimdOrigin(req: Request): string | null {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return null;
  }
  const host =
    first(req.headers.get("x-forwarded-host")) ?? first(req.headers.get("host")) ?? url.host;

  // Sem lixo no host: nada de caminho, credenciais, espaço, barra invertida ou IPv6 literal.
  if (/[/@\s\\[\]]/.test(host)) return null;

  const local = LOCAL_HOST.test(host);
  const forwardedHttps = first(req.headers.get("x-forwarded-proto")) === "https";
  // Fora do localhost só vale https: o req.url é https, ou o host público veio de um proxy
  // (header diferente do host de req.url, ou x-forwarded-proto: https). http cru -> recusado.
  const viaProxy = forwardedHttps || host !== url.host;
  const proto = local
    ? forwardedHttps
      ? "https"
      : url.protocol.replace(/:$/, "")
    : url.protocol === "https:" || viaProxy
      ? "https"
      : url.protocol.replace(/:$/, "");
  if (proto !== "https" && proto !== "http") return null;

  let origin: URL;
  try {
    origin = new URL(`${proto}://${host}`);
  } catch {
    return null;
  }
  if (origin.host !== host) return null;
  if (proto === "http" && !local) return null;
  return origin.origin;
}
