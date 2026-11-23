/* eslint-disable @next/next/no-img-element -- logos vêm direto da origem (img-src https:), sem proxy nem otimização. */
"use client";

import Link from "next/link";
import { useState } from "react";
import type { ScoreResult } from "@/lib/client/score/score";
import { STACKS } from "@/lib/shared/stacks";
import type { JobSummary } from "@/lib/shared/types/job";
import { ChanceBadge } from "./ChanceBadge";
import { FavoriteButton, HideButton, StatusBadge, StatusSelect, useJobState } from "./JobActions";
import {
  LANGUAGE_LABELS,
  NEW_WITHIN_MS,
  SENIORITY_LABELS,
  WORK_MODE_LABELS,
  formatAge,
  placeLabel,
  sourceLabel,
} from "./format";

const STACK_LABEL = new Map(STACKS.map((s) => [s.id, s.label]));
const PILL = "rounded-full bg-jf-chip px-2.5 py-1 text-[13px] text-jf-ink-2";
const MAX_STACKS = 6;

function Logo({ job }: { job: JobSummary }) {
  const [failed, setFailed] = useState(false);
  const initial = job.company.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      aria-hidden="true"
      className="hidden size-12 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-jf-chip font-display text-lg font-bold text-jf-ink-2 sm:flex"
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

/** `chance` é null sem perfil (e no pré-render): o selo convida a importar o currículo. */
export function JobCard({
  job,
  now,
  chance = null,
  onHidden,
}: {
  job: JobSummary;
  now: number;
  chance?: ScoreResult | null;
  /** Chamado depois de ocultar: a tela pode oferecer "Desfazer". */
  onHidden?: (job: JobSummary) => void;
}) {
  const state = useJobState(job.id);
  const isNew = now - new Date(job.publishedAt).getTime() < NEW_WITHIN_MS;
  const stacks = job.stacks.slice(0, MAX_STACKS);

  return (
    <article className="flex flex-wrap items-start gap-x-5 gap-y-3 rounded-2xl border border-jf-line bg-jf-surface p-4 sm:p-5">
      <Logo job={job} />
      <div className="flex min-w-0 flex-[999_1_240px] flex-col gap-2 sm:basis-[380px]">
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
            className="text-jf-ink no-underline outline-none hover:text-jf-brand-dark hover:underline focus-visible:ring-2 focus-visible:ring-jf-brand"
          >
            {job.title}
          </Link>
        </h3>
        <p className="text-sm text-jf-ink-2 sm:text-[15px]">
          {job.company} · {placeLabel(job)}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {job.workMode !== "unknown" && <span className={PILL}>{WORK_MODE_LABELS[job.workMode]}</span>}
          {job.seniority && <span className={PILL}>{SENIORITY_LABELS[job.seniority]}</span>}
          <span className={PILL}>{LANGUAGE_LABELS[job.language] ?? job.language.toUpperCase()}</span>
          {stacks.map((id) => (
            <span key={id} className="rounded-full border border-jf-line px-2.5 py-1 text-[13px] text-jf-ink-2">
              {STACK_LABEL.get(id) ?? id}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-1 basis-full flex-col items-start gap-3 sm:basis-[220px] sm:items-end">
        <ChanceBadge band={chance?.band ?? null} score={chance?.score} />
        <div className="flex flex-wrap items-center gap-2">
          <FavoriteButton job={job} />
          <StatusSelect job={job} />
          <HideButton job={job} onHidden={() => onHidden?.(job)} />
        </div>
      </div>
    </article>
  );
}
