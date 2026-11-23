import "server-only";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { sourceState } from "@/lib/server/db/schema";
import type { Db } from "@/lib/server/db/client";
import type { SourceId } from "@/lib/shared/types/job";

/**
 * Lock por fonte (D-07): `UPDATE … WHERE locked_until < now()` num único
 * statement, então duas coletas simultâneas nunca passam as duas. O relógio é o
 * do banco (também usado na comparação), independente do `now` injetado.
 */
export async function acquireLock(db: Db, source: SourceId, ttlMs: number): Promise<boolean> {
  await db.insert(sourceState).values({ source }).onConflictDoNothing();
  const rows = await db
    .update(sourceState)
    .set({ lockedUntil: sql`now() + ${ttlMs} * interval '1 millisecond'` })
    .where(
      and(
        eq(sourceState.source, source),
        or(isNull(sourceState.lockedUntil), lt(sourceState.lockedUntil, sql`now()`)),
      ),
    )
    .returning({ source: sourceState.source });
  return rows.length > 0;
}

export async function releaseLock(db: Db, source: SourceId): Promise<void> {
  await db.update(sourceState).set({ lockedUntil: null }).where(eq(sourceState.source, source));
}
