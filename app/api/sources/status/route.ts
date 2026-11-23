import { getHttpDb } from "@/lib/server/db/client";
import { cachedJson, internalError, SOURCES_STATUS_CDN_CACHE } from "@/lib/server/jobs/http";
import { listSourcesStatus } from "@/lib/server/sources/status";

// Sem `cacheComponents`, o cache é só o da CDN: a rota nunca é pré-renderizada.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const sources = await listSourcesStatus(getHttpDb());
    return cachedJson({ sources }, "sources-status", SOURCES_STATUS_CDN_CACHE);
  } catch (err) {
    return internalError(err);
  }
}
