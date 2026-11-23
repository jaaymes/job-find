import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

const PREFIX = "Bearer ";

const sha256 = (value: string) => createHash("sha256").update(value).digest();

/**
 * SEC-04: valida `Authorization: Bearer <segredo>` em tempo constante.
 * Os dois lados passam por SHA-256, então os buffers têm sempre o mesmo tamanho.
 * Header ausente, malformado ou segredo vazio nunca autenticam.
 */
export function verifyCronSecret(header: string | null, secret: string): boolean {
  if (!header || !secret || !header.startsWith(PREFIX)) return false;
  const token = header.slice(PREFIX.length);
  if (!token || token !== token.trim()) return false;
  return timingSafeEqual(sha256(token), sha256(secret));
}
