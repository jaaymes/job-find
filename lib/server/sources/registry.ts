import "server-only";
import type { SourceId } from "@/lib/shared/types/job";
import type { Connector } from "@/lib/server/sources/types";
import { ashby } from "@/lib/server/sources/ashby";
import { fourdayweek } from "@/lib/server/sources/fourdayweek";
import { getonboard } from "@/lib/server/sources/getonboard";
import { github } from "@/lib/server/sources/github";
import { greenhouse } from "@/lib/server/sources/greenhouse";
import { himalayas } from "@/lib/server/sources/himalayas";
import { hn } from "@/lib/server/sources/hn";
import { jobicy } from "@/lib/server/sources/jobicy";
import { lever } from "@/lib/server/sources/lever";
import { remoteok } from "@/lib/server/sources/remoteok";
import { smartrecruiters } from "@/lib/server/sources/smartrecruiters";
import { wwr } from "@/lib/server/sources/wwr";

/** Preenchido pelas Tarefas 11–14 e 38; começa vazio. */
export const CONNECTORS: Partial<Record<SourceId, Connector>> = {
  ashby,
  fourdayweek,
  getonboard,
  github,
  greenhouse,
  himalayas,
  hn,
  jobicy,
  lever,
  remoteok,
  smartrecruiters,
  wwr,
};

export function attributionFor(source: SourceId): { label: string; dofollow: boolean } | null {
  const a = CONNECTORS[source]?.attribution;
  return a ? { label: a.label, dofollow: a.dofollow } : null;
}
