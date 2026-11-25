"use client";

import { X } from "lucide-react";
import type { PageFilters } from "@/lib/client/jobs/use-jobs";
import type { Seniority, SourceId } from "@/lib/shared/types/job";
import { LANGUAGE_LABELS, SENIORITY_LABELS, SINCE_OPTIONS, SOURCE_LABELS } from "./format";

export type ActiveChip = { key: string; label: string; onRemove: () => void };

const ORIGIN_LABELS = { national: "Nacional", international: "Internacional" } as const;
const CHANCE_LABELS = { alta: "Alta", media: "Média", baixa: "Baixa" } as const;

/** Um chip por filtro do painel (e por período); busca, tecnologias e modelo de trabalho têm controle próprio na tela. */
export function buildActiveChips(
  filters: PageFilters,
  onChange: (patch: PageFilters) => void,
  hasProfile: boolean,
): ActiveChip[] {
  const chips: ActiveChip[] = [];
  const add = (key: keyof PageFilters, label: string) => chips.push({ key, label, onRemove: () => onChange({ [key]: undefined }) });
  if (filters.origin) add("origin", ORIGIN_LABELS[filters.origin]);
  if (filters.acceptsBrazil) add("acceptsBrazil", "Aceita quem mora no Brasil");
  if (hasProfile && filters.chance?.length) add("chance", `Chance: ${filters.chance.map((c) => CHANCE_LABELS[c]).join(", ")}`);
  if (filters.seniority?.length) {
    add("seniority", filters.seniority.map((s: Seniority) => SENIORITY_LABELS[s]).join(", "));
  }
  if (filters.lang) add("lang", LANGUAGE_LABELS[filters.lang] ?? filters.lang);
  if (filters.since) add("since", SINCE_OPTIONS.find((o) => o.value === filters.since)?.label ?? filters.since);
  if (filters.source?.length) add("source", filters.source.map((s: SourceId) => SOURCE_LABELS[s]).join(", "));
  if (filters.showHidden) add("showHidden", "Com vagas ocultas");
  return chips;
}

type Props = { chips: ActiveChip[]; onClearAll: () => void };

export function ActiveFilterChips({ chips, onClearAll }: Props) {
  if (chips.length === 0) return null;
  return (
    <ul aria-label="Filtros ativos" className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
      {chips.map((chip) => (
        <li
          key={chip.key}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-jf-line-strong bg-jf-surface py-0.5 pr-1 pl-2.5 text-[13px] text-jf-ink-2"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            aria-label={`Remover filtro: ${chip.label}`}
            className="inline-flex size-6 items-center justify-center rounded-full bg-jf-chip text-jf-ink-2 outline-none hover:text-jf-ink focus-visible:ring-2 focus-visible:ring-jf-brand"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </li>
      ))}
      <li>
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex min-h-8 items-center rounded-md px-1 text-[13px] font-semibold text-jf-brand outline-none hover:text-jf-brand-dark focus-visible:ring-2 focus-visible:ring-jf-brand"
        >
          Limpar tudo
        </button>
      </li>
    </ul>
  );
}
