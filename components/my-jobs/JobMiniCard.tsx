"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { FavoriteButton, HideButton, formatStatusDate, useJobMenuActions } from "@/components/jobs/JobActions";
import { WORK_MODE_LABELS } from "@/components/jobs/format";
import { CARD } from "@/components/ui/styles";
import { JOB_STATUSES, STATUS_LABELS, appliedAt, type JobState } from "@/lib/client/jobs/job-state";
import { safeExternalUrl } from "@/lib/shared/safe-url";
import { STACKS } from "@/lib/shared/stacks";
import { cn } from "@/lib/utils";

const STACK_LABEL = new Map(STACKS.map((s) => [s.id, s.label]));
const MAX_STACKS = 5;

const POPUP = "z-50 min-w-48 rounded-xl border border-jf-line bg-jf-surface p-1 text-jf-ink shadow-lg outline-none";
const ITEM =
  "flex min-h-11 cursor-default items-center justify-between gap-2 rounded-lg px-3 text-sm outline-none select-none data-[highlighted]:bg-jf-chip sm:min-h-10";

/** Cartão de "Minhas vagas": desenhado só com o snapshot, sem chamar a API. */
export function JobMiniCard({ state }: { state: JobState }) {
  const { snapshot } = state;
  const source = safeExternalUrl(snapshot.urlCanonical);
  const menu = useJobMenuActions(snapshot);
  const applied = appliedAt(state);
  const dateLabel = applied
    ? `Aplicada em ${formatStatusDate(applied)}`
    : `Publicada em ${formatStatusDate(snapshot.publishedAt)}`;
  return (
    <article className={`${CARD} flex flex-col gap-2 p-3.5`} data-job-id={snapshot.id}>
      <div className="flex items-center justify-between gap-2 text-xs text-jf-ink-3">
        <span className="min-w-0 truncate">
          {snapshot.company}
          {snapshot.workMode !== "unknown" ? ` · ${WORK_MODE_LABELS[snapshot.workMode]}` : ""}
        </span>
        <span className="shrink-0">{dateLabel}</span>
      </div>
      <h3 className="text-base leading-snug font-semibold">
        <Link
          href={`/vagas/${snapshot.id}`}
          className="text-jf-ink no-underline outline-none hover:text-jf-brand-dark hover:underline focus-visible:ring-2 focus-visible:ring-jf-brand"
        >
          {snapshot.title}
        </Link>
      </h3>
      {snapshot.stacks.length > 0 && (
        <p className="text-[13px] text-jf-ink-3">
          {snapshot.stacks
            .slice(0, MAX_STACKS)
            .map((id) => STACK_LABEL.get(id) ?? id)
            .join(" · ")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <FavoriteButton job={snapshot} />
        {state.hidden && <HideButton job={snapshot} className="min-h-11" />}
        {source && (
          <a
            href={source}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex min-h-11 items-center text-[13px] text-jf-brand-dark underline"
          >
            Ver na fonte <span aria-hidden="true">&nbsp;↗</span>
            <span className="sr-only"> (abre em nova aba)</span>
          </a>
        )}
        <Menu.Root>
          <Menu.Trigger
            aria-label={`Mover ${snapshot.title}`}
            className={cn(
              "ml-auto inline-flex min-h-11 items-center gap-1 rounded-[10px] border border-jf-field-border bg-jf-surface px-3 text-[13px] font-semibold text-jf-ink outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-jf-brand data-[popup-open]:bg-jf-chip",
            )}
          >
            Mover
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner align="end" sideOffset={4} className="z-50">
              <Menu.Popup className={POPUP}>
                <Menu.RadioGroup
                  value={state.status}
                  onValueChange={(v) => menu.changeStatus(v as (typeof JOB_STATUSES)[number])}
                >
                  {JOB_STATUSES.map((s) => (
                    <Menu.RadioItem key={s} value={s} closeOnClick className={ITEM}>
                      {STATUS_LABELS[s]}
                      <Menu.RadioItemIndicator>
                        <Check aria-hidden="true" className="size-4" />
                      </Menu.RadioItemIndicator>
                    </Menu.RadioItem>
                  ))}
                </Menu.RadioGroup>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
        {menu.feedback}
      </div>
    </article>
  );
}
