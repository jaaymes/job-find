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
import { arbeitnow } from "@/lib/server/sources/arbeitnow";
import { gupy } from "@/lib/server/sources/gupy";
import { linkedin } from "@/lib/server/sources/linkedin";
import { wwr } from "@/lib/server/sources/wwr";

/** Um conector por fonte do catálogo (`lib/shared/sources.ts`): o TypeScript acusa se faltar algum id. */
export const CONNECTORS: Record<SourceId, Connector> = {
  arbeitnow,
  ashby,
  fourdayweek,
  getonboard,
  github,
  greenhouse,
  gupy,
  himalayas,
  hn,
  jobicy,
  lever,
  linkedin,
  remoteok,
  smartrecruiters,
  wwr,
};

export function attributionFor(source: SourceId): { label: string; dofollow: boolean } | null {
  const a = CONNECTORS[source].attribution;
  return a ? { label: a.label, dofollow: a.dofollow } : null;
}
