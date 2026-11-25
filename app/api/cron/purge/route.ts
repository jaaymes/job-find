import { rejectCronRequest } from "@/lib/server/cron-auth";
import { getPoolDb } from "@/lib/server/db/client";
import { purgeOld } from "@/lib/server/jobs/expire";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

async function handler(req: Request): Promise<Response> {
  const rejected = rejectCronRequest(req, "cron/purge");
  if (rejected) return rejected;

  let db: ReturnType<typeof getPoolDb> | undefined;
  try {
    db = getPoolDb();
    const result = await purgeOld(db, new Date());
    console.log(`[cron/purge] jobs=${result.jobs} sourceRuns=${result.sourceRuns}`);
    return Response.json(result, { status: 200, headers: NO_STORE });
  } catch (e) {
    console.error("[cron/purge] limpeza falhou:", e instanceof Error ? e.message : String(e));
    return Response.json(
      { error: { code: "internal", message: "Falha na limpeza." } },
      { status: 500, headers: NO_STORE },
    );
  } finally {
    try {
      await db?.$client.end();
    } catch (e) {
      console.error("[cron/purge] falha ao fechar o pool:", e instanceof Error ? e.message : String(e));
    }
  }
}

export { handler as GET, handler as POST };
