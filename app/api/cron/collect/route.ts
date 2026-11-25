import { invalidateByTag } from "@vercel/functions";
import { after } from "next/server";
import { runCollection } from "@/lib/server/collect/run";
import { rejectCronRequest } from "@/lib/server/cron-auth";
import { getPoolDb } from "@/lib/server/db/client";
import { CONNECTORS } from "@/lib/server/sources/registry";
import type { SourceId } from "@/lib/shared/types/job";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function parseSources(raw: string | null): SourceId[] | null {
  const all = Object.keys(CONNECTORS) as SourceId[];
  if (raw === null) return all;
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0 || !ids.every((id) => Object.hasOwn(CONNECTORS, id))) return null;
  return [...new Set(ids)] as SourceId[];
}

async function collectInBackground(sources: SourceId[]): Promise<void> {
  let db: ReturnType<typeof getPoolDb> | undefined;
  try {
    db = getPoolDb();
    const results = await runCollection({
      db,
      sources,
      now: new Date(),
      invalidate: (tag) => invalidateByTag(tag),
    });
    console.log(
      "[cron/collect]",
      results
        .map((r) => `${r.source}:${r.status} +${r.inserted} ~${r.updated} =${r.unchanged} -${r.expired} err=${r.errors}`)
        .join(" | "),
    );
  } catch (e) {
    console.error("[cron/collect] coleta falhou:", e instanceof Error ? e.message : String(e));
  } finally {
    try {
      await db?.$client.end();
    } catch (e) {
      console.error("[cron/collect] falha ao fechar o pool:", e instanceof Error ? e.message : String(e));
    }
  }
}

async function handler(req: Request): Promise<Response> {
  const rejected = rejectCronRequest(req, "cron/collect");
  if (rejected) return rejected;

  const sources = parseSources(new URL(req.url).searchParams.get("sources"));
  if (!sources) {
    return json(400, {
      error: {
        code: "invalid_sources",
        message: `Fonte desconhecida. Válidas: ${Object.keys(CONNECTORS).join(", ")}.`,
      },
    });
  }

  after(() => collectInBackground(sources));
  return json(202, { accepted: sources });
}

export { handler as GET, handler as POST };
