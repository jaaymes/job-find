import "server-only";
import { createHash } from "node:crypto";
import type { WorkMode } from "@/lib/shared/types/job";
import { normalizeText } from "./text";

const sha1 = (value: string) => createHash("sha1").update(value).digest("hex");

/** RN-05: empresa + título + país + cidade + modelo de trabalho, normalizados. */
export function dedupeKey(i: {
  company: string;
  title: string;
  country: string | null;
  city: string | null;
  workMode: WorkMode;
}): string {
  return sha1(
    [i.company, i.title, i.country, i.city, i.workMode].map((v) => normalizeText(v)).join("|"),
  );
}

export function contentHash(parts: string[]): string {
  return sha1(parts.join("\u0000"));
}
