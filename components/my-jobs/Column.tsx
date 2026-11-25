"use client";

import type { JobState } from "@/lib/client/jobs/job-state";
import { cn } from "@/lib/utils";
import { JobMiniCard } from "./JobMiniCard";

/** Coluna do funil de "Minhas vagas" (ou lista simples, no modo `grid`), da vaga mais recente para a mais antiga. */
export function Column({
  id,
  name,
  dot,
  jobs,
  empty,
  className,
  grid = false,
}: {
  id: string;
  name: string;
  /** Classe de cor (`bg-jf-*`) da bolinha do cabeçalho. */
  dot?: string;
  jobs: JobState[];
  empty: string;
  className?: string;
  grid?: boolean;
}) {
  return (
    <section
      id={id}
      aria-label={name}
      data-count={jobs.length}
      className={cn("flex-col gap-2.5 rounded-[14px] lg:border lg:border-jf-line lg:bg-jf-surface-2 lg:p-3", className)}
    >
      <div className="hidden items-center gap-2 px-1 pt-1 lg:flex">
        {dot && <span aria-hidden="true" className={cn("size-2.5 rounded-full", dot)} />}
        <h2 className="flex-1 text-[15px] font-semibold">{name}</h2>
        <span className="rounded-full bg-jf-chip px-2 text-[13px] font-semibold text-jf-ink-2 tabular-nums">
          {jobs.length}
        </span>
      </div>
      {jobs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-jf-line-strong p-4 text-center text-[13px] leading-normal text-jf-ink-3">
          {empty}
        </p>
      ) : (
        <ul className={cn("grid list-none gap-2.5", grid && "sm:grid-cols-2 xl:grid-cols-3")}>
          {jobs.map((s) => (
            <li key={s.snapshot.id} className="min-w-0">
              <JobMiniCard state={s} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
