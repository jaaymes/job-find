"use client";

import type { JobState } from "@/lib/client/jobs/job-state";
import { JobMiniCard } from "./JobMiniCard";

/** Lista de uma aba de "Minhas vagas", da vaga publicada mais recentemente para a mais antiga. */
export function Column({ jobs, empty }: { jobs: JobState[]; empty: string }) {
  if (jobs.length === 0) {
    return <p className="rounded-2xl border border-jf-line bg-jf-surface p-6 text-center text-sm text-jf-ink-3">{empty}</p>;
  }
  return (
    <ul className="grid list-none gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
      {jobs.map((s) => (
        <li key={s.snapshot.id} className="min-w-0">
          <JobMiniCard state={s} />
        </li>
      ))}
    </ul>
  );
}
