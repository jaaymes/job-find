"use client";

import { useRef } from "react";
import type { JobsPage } from "@/lib/client/jobs/use-jobs";
import { cn } from "@/lib/utils";

type Mode = "remote" | "hybrid" | "onsite" | undefined;

const TABS: { id: string; mode: Mode; label: string; count: keyof NonNullable<JobsPage["counts"]> }[] = [
  { id: "all", mode: undefined, label: "Todas", count: "all" },
  { id: "remote", mode: "remote", label: "Remoto", count: "remote" },
  { id: "hybrid", mode: "hybrid", label: "Híbrido", count: "hybrid" },
  { id: "onsite", mode: "onsite", label: "Presencial", count: "onsite" },
];

type Props = {
  value: Mode;
  counts: JobsPage["counts"] | undefined;
  onChange: (mode: Mode) => void;
  panelId: string;
};

export function ModeTabs({ value, counts, onChange, panelId }: Props) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const activeIndex = Math.max(0, TABS.findIndex((t) => t.mode === value));

  // Setas movem o foco e a seleção (padrão WAI-ARIA para abas).
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const target = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (index + step + TABS.length) % TABS.length;
    if (step === 0 && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    refs.current[target]?.focus();
    onChange(TABS[target].mode);
  };

  return (
    <div role="tablist" aria-label="Modelo de trabalho" className="flex gap-0.5 overflow-x-auto border-b border-jf-line sm:flex-wrap sm:gap-1.5 sm:overflow-visible">
      {TABS.map((tab, i) => {
        const selected = i === activeIndex;
        const count = counts?.[tab.count];
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.mode)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "min-h-11 flex-1 whitespace-nowrap border-b-[3px] px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-jf-brand sm:flex-none sm:px-4 sm:text-[15px]",
              selected ? "border-jf-ink font-semibold text-jf-ink" : "border-transparent text-jf-ink-2 hover:text-jf-ink",
            )}
          >
            {tab.label}
            {count !== undefined && (
              <span className={cn("ml-1.5 text-jf-ink-3 tabular-nums", selected ? "font-medium" : "")}> {count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
