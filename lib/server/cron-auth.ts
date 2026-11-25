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

const warnedMissingSecret = new Set<string>();

/**
 * Recusa a chamada de cron quando falta `CRON_SECRET` ou o header não confere.
 * Devolve a resposta 401 ou `null` quando autorizada. Sem segredo, avisa uma vez por rota.
 */
export function rejectCronRequest(req: Request, label: string): Response | null {
  const unauthorized = () =>
    Response.json(
      { error: { code: "unauthorized", message: "Não autorizado." } },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    if (!warnedMissingSecret.has(label)) {
      warnedMissingSecret.add(label);
      console.error(`[${label}] CRON_SECRET não está definida: todas as chamadas serão recusadas.`);
    }
    return unauthorized();
  }
  if (!verifyCronSecret(req.headers.get("authorization"), secret)) return unauthorized();
  return null;
}
