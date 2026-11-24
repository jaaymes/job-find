import { and, desc, eq, isNotNull } from "drizzle-orm";
import { getHttpDb } from "@/lib/server/db/client";
import { sourceRuns } from "@/lib/server/db/schema";
import { cachedJson, errorJson, internalError } from "@/lib/server/jobs/http";
import { InvalidCursorError, listJobs } from "@/lib/server/jobs/query";
import { parseJobsQuery } from "@/lib/shared/schemas/jobs-query";

// Sem `cacheComponents`, o cache é só o da CDN (D-01/D-06): a rota nunca é pré-renderizada.
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const parsed = parseJobsQuery(new URL(req.url).searchParams);
  if (!parsed.ok) return errorJson(400, parsed.error);
  const q = parsed.value;

  try {
    const db = getHttpDb();
    // Contadores só na primeira página (D-06).
    const [result, [lastRun]] = await Promise.all([
      listJobs(db, q, !q.cursor),
      db
        .select({ finishedAt: sourceRuns.finishedAt })
        .from(sourceRuns)
        .where(and(eq(sourceRuns.status, "ok"), isNotNull(sourceRuns.finishedAt)))
        .orderBy(desc(sourceRuns.finishedAt))
        .limit(1),
    ]);
    return cachedJson({ ...result, lastCollectedAt: lastRun?.finishedAt?.toISOString() ?? null }, "jobs");
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      return errorJson(400, { code: "invalid_query", message: "Parâmetro inválido: cursor" });
    }
    return internalError(err);
  }
}
