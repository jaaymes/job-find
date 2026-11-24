import "server-only";

const CDN_CACHE = "max-age=900, stale-while-revalidate=86400, stale-if-error=86400";

/** Status das fontes: 5 min na CDN (RF-21), sem depender de invalidação por tag. */
export const SOURCES_STATUS_CDN_CACHE = "s-maxage=300, stale-while-revalidate=600, stale-if-error=3600";

/** Respostas de sucesso: cache na CDN invalidado por tag (D-06). */
export function cachedJson(body: unknown, tags: string, cdnCache: string = CDN_CACHE): Response {
  return Response.json(body, {
    headers: {
      "Vercel-CDN-Cache-Control": cdnCache,
      "Vercel-Cache-Tag": tags,
      "Cache-Control": "public, max-age=30",
    },
  });
}

/** Erros nunca entram no cache longo: um 500 cacheado seria servido por 15 min. */
export function errorJson(status: 400 | 404 | 500, error: { code: string; message?: string }): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export function internalError(err: unknown): Response {
  console.error("[api/jobs] erro inesperado", err);
  return errorJson(500, { code: "internal" });
}
