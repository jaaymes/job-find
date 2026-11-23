"use client";

import Link from "next/link";
import { FavoriteButton, HideButton, StatusBadge, StatusSelect } from "@/components/jobs/JobActions";
import { WORK_MODE_LABELS } from "@/components/jobs/format";
import { BTN_OUTLINE, CARD } from "@/components/ui/styles";
import type { JobState } from "@/lib/client/jobs/job-state";
import { STACKS } from "@/lib/shared/stacks";

const STACK_LABEL = new Map(STACKS.map((s) => [s.id, s.label]));
const MAX_STACKS = 5;

/** Só http(s) vira link externo. */
function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** Cartão de "Minhas vagas": desenhado só com o snapshot, sem chamar a API. */
export function JobMiniCard({ state }: { state: JobState }) {
  const { snapshot } = state;
  const source = safeUrl(snapshot.urlCanonical);
  return (
    <article className={`${CARD} flex flex-col gap-3 p-4`} data-job-id={snapshot.id}>
      <div className="flex flex-col gap-1.5">
        <StatusBadge state={state} />
        <h3 className="text-base leading-snug font-semibold">
          <Link
            href={`/vagas/${snapshot.id}`}
            className="text-jf-ink no-underline outline-none hover:text-jf-brand-dark hover:underline focus-visible:ring-2 focus-visible:ring-jf-brand"
          >
            {snapshot.title}
          </Link>
        </h3>
        <p className="text-sm text-jf-ink-2">
          {snapshot.company}
          {snapshot.workMode !== "unknown" ? ` · ${WORK_MODE_LABELS[snapshot.workMode]}` : ""}
        </p>
        {snapshot.stacks.length > 0 && (
          <p className="text-[13px] text-jf-ink-3">
            {snapshot.stacks
              .slice(0, MAX_STACKS)
              .map((id) => STACK_LABEL.get(id) ?? id)
              .join(" · ")}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <FavoriteButton job={snapshot} />
        <StatusSelect job={snapshot} />
        {state.hidden && <HideButton job={snapshot} />}
        {source && (
          <a
            href={source}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={`${BTN_OUTLINE} text-[13px] no-underline`}
          >
            Ver na fonte <span aria-hidden="true">&nbsp;↗</span>
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
        )}
      </div>
    </article>
  );
}
