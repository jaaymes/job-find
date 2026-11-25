/* eslint-disable @next/next/no-img-element -- logos vêm direto da origem (img-src https:), sem proxy nem otimização. */
"use client";

import Link from "next/link";
import { useState } from "react";
import type { ScoreResult } from "@/lib/client/score/score";
import { cn } from "@/lib/utils";
import { STACKS } from "@/lib/shared/stacks";
import type { JobSummary } from "@/lib/shared/types/job";
import { ChanceBadge } from "./ChanceBadge";
import { FavoriteButton, StatusBadge, useJobMenuActions, useJobState } from "./JobActions";
import { buildGlassdoorUrl } from "@/lib/client/jobs/glassdoor";
import { markListReturn } from "@/lib/client/jobs/list-href";
import { JobCardMenu } from "./JobCardMenu";
import {
  LANGUAGE_LABELS,
  SENIORITY_LABELS,
  WORK_MODE_LABELS,
  formatAge,
  formatSalary,
  placeLabel,
  sourceLabel,
} from "./format";

const STACK_LABEL = new Map(STACKS.map((s) => [s.id, s.label]));
const PILL = "rounded-full bg-jf-chip px-2.5 py-1 text-[13px] text-jf-ink-2";
const MAX_STACKS = 6;
/** No celular o card mostra só estes chips; o resto vira "+n". */
const MOBILE_MAX_TAGS = 3;

function Logo({ job }: { job: JobSummary }) {
  const [failed, setFailed] = useState(false);
  const initial = job.company.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      aria-hidden="true"
      className="flex size-10 shrink-0 sm:size-12 items-center justify-center overflow-hidden rounded-[10px] bg-jf-chip font-display text-lg font-bold text-jf-ink-2"
    >
      {job.companyLogoUrl && !failed ? (
        <img
          src={job.companyLogoUrl}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          width={48}
          height={48}
          className="size-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        initial
      )}
    </div>
  );
}

/** `chance` é null sem perfil (e no pré-render): sem faixa, o selo não aparece (o convite vive no banner da lista). */
export function JobCard({
  job,
  now,
  chance = null,
  isNew = false,
  onHidden,
  maxTags = MOBILE_MAX_TAGS,
}: {
  job: JobSummary;
  now: number;
  chance?: ScoreResult | null;
  /** Publicada depois da visita anterior (a tela decide; ver `isNewSince`). */
  isNew?: boolean;
  /** Chamado depois de ocultar: a tela pode oferecer "Desfazer". */
  onHidden?: (job: JobSummary) => void;
  /** Chips visíveis no celular; do `sm` em diante aparecem todos. */
  maxTags?: number;
}) {
  const state = useJobState(job.id);
  const menu = useJobMenuActions(job, () => onHidden?.(job));
  const salary = formatSalary(job);

  const tags: { key: string; label: string; outline?: boolean }[] = [];
  if (job.workMode !== "unknown") tags.push({ key: "mode", label: WORK_MODE_LABELS[job.workMode] });
  if (job.seniority) tags.push({ key: "seniority", label: SENIORITY_LABELS[job.seniority] });
  tags.push({ key: "lang", label: LANGUAGE_LABELS[job.language] ?? job.language.toUpperCase() });
  for (const id of job.stacks.slice(0, MAX_STACKS)) tags.push({ key: `s-${id}`, label: STACK_LABEL.get(id) ?? id, outline: true });
  const overflow = tags.length - maxTags;

  return (
    <article className="relative flex items-start gap-3 rounded-2xl border border-jf-line bg-jf-surface p-4 has-[h3_a:focus-visible]:ring-2 has-[h3_a:focus-visible]:ring-jf-brand sm:gap-5 sm:p-5">
      <Logo job={job} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {isNew && (
            <span className="rounded-md bg-jf-new-bg px-2 py-0.5 text-xs font-semibold text-jf-new-fg">Nova</span>
          )}
          <span className="text-xs text-jf-ink-3 sm:text-[13px]">
            {formatAge(job.publishedAt, now)} · via {sourceLabel(job.sources)}
          </span>
          <StatusBadge state={state} />
          {state?.hidden && (
            <span className="rounded-md bg-jf-chip px-2 py-0.5 text-xs font-semibold text-jf-ink-2">Oculta</span>
          )}
        </div>
        <h3 className="text-base leading-snug font-semibold sm:text-lg">
          <Link
            href={`/vagas/${job.id}`}
            onClick={(e) => {
              if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) markListReturn(job.id);
            }}
            className="text-jf-ink no-underline outline-none after:absolute after:inset-0 after:rounded-2xl hover:text-jf-brand-dark hover:underline"
          >
            {job.title}
          </Link>
        </h3>
        <p className="text-sm text-jf-ink-2 sm:text-[15px]">
          {job.company} · {placeLabel(job)}
        </p>
        {salary && <p className="text-sm font-medium text-jf-ink sm:text-[15px]">{salary}</p>}
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t, i) => (
            <span
              key={t.key}
              className={cn(
                t.outline ? "rounded-full border border-jf-line px-2.5 py-1 text-[13px] text-jf-ink-2" : PILL,
                i >= maxTags && "hidden sm:inline",
              )}
            >
              {t.label}
            </span>
          ))}
          {overflow > 0 && <span className={cn(PILL, "sm:hidden")}>+{overflow}</span>}
        </div>
        {menu.feedback}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-3">
        <div className="-mt-2 -mr-2 flex max-w-40 flex-wrap items-center justify-end sm:mt-0 sm:mr-0 sm:gap-1">
          <FavoriteButton
            job={job}
            className="relative z-10 border-0 bg-transparent md:size-10"
          />
          <JobCardMenu
            jobId={job.id}
            title={job.title}
            jobUrl={`/vagas/${job.id}`}
            status={menu.status}
            hidden={menu.hidden}
            glassdoorUrl={buildGlassdoorUrl(job.company, job.origin)}
            onHide={menu.toggleHidden}
            onStatusChange={menu.changeStatus}
          />
        </div>
        <ChanceBadge band={chance?.band ?? null} score={chance?.score} />
      </div>
    </article>
  );
}
