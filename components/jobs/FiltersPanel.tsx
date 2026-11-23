"use client";

import type { JobsFilters } from "@/lib/client/jobs/use-jobs";
import type { Seniority, SourceId } from "@/lib/shared/types/job";
import { cn } from "@/lib/utils";
import { LANGUAGE_LABELS, SENIORITY_LABELS, SOURCE_LABELS } from "./format";

type Props = {
  filters: JobsFilters;
  onChange: (patch: JobsFilters) => void;
  onClear: () => void;
  /** Painel recolhido no celular; no desktop é sempre visível. */
  open: boolean;
  id: string;
};

const ORIGINS = [
  { value: undefined, label: "Todas" },
  { value: "national", label: "Nacional" },
  { value: "international", label: "Internacional" },
] as const;

const FIELD = "rounded-lg border border-jf-line-strong bg-jf-surface p-2.5 text-[15px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-jf-brand";
const LEGEND = "mb-2 text-[13px] font-semibold text-jf-ink-2";
const OPTION = "flex min-h-8 items-center gap-2";
const CONTROL = "size-4 accent-jf-brand";

export function FiltersPanel({ filters, onChange, onClear, open, id }: Props) {
  const seniority = filters.seniority ?? [];

  return (
    <aside
      id={id}
      aria-label="Filtros"
      className={cn(
        "flex-col gap-5 rounded-2xl border border-jf-line bg-jf-surface p-5 lg:max-w-[300px] lg:flex-[1_1_260px]",
        open ? "flex" : "hidden lg:flex",
      )}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Filtros</h2>
        <button
          type="button"
          onClick={onClear}
          className="py-2 text-sm text-jf-brand outline-none hover:text-jf-brand-dark focus-visible:ring-2 focus-visible:ring-jf-brand"
        >
          Limpar
        </button>
      </div>

      <fieldset className="flex flex-col">
        <legend className={LEGEND}>Origem</legend>
        {ORIGINS.map((o) => (
          <label key={o.label} className={OPTION}>
            <input
              type="radio"
              name="origem"
              className={CONTROL}
              checked={filters.origin === o.value}
              onChange={() => onChange({ origin: o.value })}
            />
            {o.label}
          </label>
        ))}
        <label className="mt-2 flex items-center gap-2 rounded-lg bg-jf-bg p-2.5 text-sm">
          <input
            type="checkbox"
            className={CONTROL}
            checked={filters.acceptsBrazil === true}
            onChange={(e) => onChange({ acceptsBrazil: e.target.checked ? true : undefined })}
          />
          Só vagas que aceitam quem mora no Brasil
        </label>
      </fieldset>

      <fieldset className="flex flex-col">
        <legend className={LEGEND}>Senioridade</legend>
        {(Object.keys(SENIORITY_LABELS) as Seniority[]).map((level) => (
          <label key={level} className={OPTION}>
            <input
              type="checkbox"
              className={CONTROL}
              checked={seniority.includes(level)}
              onChange={(e) =>
                onChange({ seniority: e.target.checked ? [...seniority, level] : seniority.filter((l) => l !== level) })
              }
            />
            {SENIORITY_LABELS[level]}
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-jf-ink-2">
        Idioma da vaga
        <select
          className={FIELD}
          value={filters.lang ?? ""}
          onChange={(e) => onChange({ lang: (e.target.value || undefined) as JobsFilters["lang"] })}
        >
          <option value="">Qualquer</option>
          {Object.entries(LANGUAGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-jf-ink-2">
        Fonte
        <select
          className={FIELD}
          value={filters.source?.[0] ?? ""}
          onChange={(e) => onChange({ source: e.target.value ? [e.target.value as SourceId] : undefined })}
        >
          <option value="">Todas as fontes</option>
          {Object.entries(SOURCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </aside>
  );
}
