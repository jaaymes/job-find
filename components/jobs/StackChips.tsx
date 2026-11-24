"use client";

import { useState } from "react";
import type { JobsFilters } from "@/lib/client/jobs/use-jobs";
import { STACKS } from "@/lib/shared/stacks";
import { cn } from "@/lib/utils";

/** Chips sempre visíveis; o resto aparece em "+ N tecnologias". */
const FEATURED = [
  "react",
  "angular",
  "vue",
  "nextjs",
  "nodejs",
  "typescript",
  "java",
  "python",
  "go",
  "dotnet",
  "flutter",
  "kotlin",
];

const BY_ID = new Map(STACKS.map((s) => [s.id, s]));

type Props = { filters: JobsFilters; onChange: (patch: JobsFilters) => void };

export function StackChips({ filters, onChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const selected = filters.stacks ?? [];

  const visible = expanded
    ? STACKS.map((s) => s.id)
    : [...FEATURED, ...selected.filter((id) => !FEATURED.includes(id))];
  const hidden = STACKS.length - FEATURED.length;

  const toggle = (id: string) => {
    onChange({ stacks: selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id] });
  };

  return (
    <div role="group" aria-label="Tecnologias" className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
      <span className="mr-1 hidden shrink-0 text-[13px] text-jf-ink-3 sm:inline">Tecnologias:</span>
      {visible.map((id) => {
        const stack = BY_ID.get(id);
        if (!stack) return null;
        const pressed = selected.includes(id);
        return (
          <button
            key={id}
            type="button"
            aria-pressed={pressed}
            onClick={() => toggle(id)}
            className={cn(
              "min-h-10 shrink-0 rounded-full border px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-jf-brand focus-visible:ring-offset-2 sm:min-h-9",
              pressed
                ? "border-jf-ink bg-jf-ink font-medium text-white"
                : "border-jf-line-strong bg-jf-surface text-jf-ink hover:bg-jf-chip",
            )}
          >
            {stack.label}
          </button>
        );
      })}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="min-h-10 shrink-0 rounded-full border border-dashed border-jf-line-strong px-3 text-sm text-jf-ink-2 outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-jf-brand sm:min-h-9"
      >
        {expanded ? "Mostrar menos" : `+ ${hidden} tecnologias`}
      </button>
      <label className="ml-2 flex shrink-0 items-center gap-1.5 text-sm text-jf-ink-2">
        <input
          type="checkbox"
          checked={filters.stacksMode === "all"}
          onChange={(e) => onChange({ stacksMode: e.target.checked ? "all" : undefined })}
          className="size-4 accent-jf-brand"
        />
        Exigir todas
      </label>
    </div>
  );
}
