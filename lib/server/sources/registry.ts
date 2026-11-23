import "server-only";
import type { SourceId } from "@/lib/shared/types/job";
import type { Connector } from "@/lib/server/sources/types";
import { ashby } from "@/lib/server/sources/ashby";
import { greenhouse } from "@/lib/server/sources/greenhouse";
import { himalayas } from "@/lib/server/sources/himalayas";
import { lever } from "@/lib/server/sources/lever";

/** Preenchido pelas Tarefas 11–14 e 38; começa vazio. */
export const CONNECTORS: Partial<Record<SourceId, Connector>> = {
  ashby,
  greenhouse,
  himalayas,
  lever,
};

export function attributionFor(source: SourceId): { label: string; dofollow: boolean } | null {
  const a = CONNECTORS[source]?.attribution;
  return a ? { label: a.label, dofollow: a.dofollow } : null;
}
