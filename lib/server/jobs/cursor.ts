import "server-only";

export type JobsCursor = { publishedAt: Date; id: number };

/** Cursor opaco: base64url de `publishedAt(ISO)|id`. */
export function encodeCursor(c: JobsCursor): string {
  return Buffer.from(`${c.publishedAt.toISOString()}|${c.id}`).toString("base64url");
}

export function decodeCursor(s: string): JobsCursor | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  const [iso, rawId, ...rest] = Buffer.from(s, "base64url").toString("utf8").split("|");
  if (rest.length > 0 || iso === undefined || rawId === undefined) return null;
  if (!/^\d{1,15}$/.test(rawId)) return null;
  const publishedAt = new Date(iso);
  if (Number.isNaN(publishedAt.getTime()) || publishedAt.toISOString() !== iso) return null;
  return { publishedAt, id: Number(rawId) };
}
