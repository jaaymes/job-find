import { getHttpDb } from "@/lib/server/db/client";
import { cachedJson, errorJson, internalError } from "@/lib/server/jobs/http";
import { getJob } from "@/lib/server/jobs/query";
import { attributionFor } from "@/lib/server/sources/registry";

export const dynamic = "force-dynamic";

const notFound = () => errorJson(404, { code: "not_found", message: "Vaga não encontrada." });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id: raw } = await ctx.params;
  const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return notFound();

  try {
    const job = await getJob(getHttpDb(), id, attributionFor);
    return job ? cachedJson(job, `jobs,job-${id}`) : notFound();
  } catch (err) {
    return internalError(err);
  }
}
