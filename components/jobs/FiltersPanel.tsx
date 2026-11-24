"use client";

import type { ChanceBand, PageFilters } from "@/lib/client/jobs/use-jobs";
import type { Seniority, SourceId } from "@/lib/shared/types/job";
import { cn } from "@/lib/utils";
import { FILTERABLE_SOURCES, LANGUAGE_LABELS, SENIORITY_LABELS, SOURCE_LABELS } from "./format";
import { HardLink } from "@/components/ui/hard-link";

type Props = {
  filters: PageFilters;
  onChange: (patch: PageFilters) => void;
  /** Sem perfil salvo não há score, e o filtro de chance fica desabilitado. */
  hasProfile: boolean;
  onClear: () => void;
  /** Painel recolhido no celular; no desktop é sempre visível. */
  open: boolean;
  id: string;
  /** Busca padrão (RF-22): salva os filtros atuais e os aplica ao abrir a home sem filtros. */
  savedSearch: { active: boolean; canSave: boolean; error: string | null; onSave: () => void; onClear: () => void };
};

const ORIGINS = [
  { value: undefined, label: "Todas" },
  { value: "national", label: "Nacional" },
  { value: "international", label: "Internacional" },
] as const;

const FIELD = "rounded-lg border border-jf-line-strong bg-jf-surface p-2.5 text-[15px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-jf-brand";
const LEGEND = "mb-2 text-[13px] font-semibold text-jf-ink-2";
const OPTION = "flex min-h-11 items-center gap-2";
const CONTROL = "size-4 accent-jf-brand";

const CHANCES: { value: ChanceBand | undefined; label: string }[] = [
  { value: undefined, label: "Qualquer" },
  { value: "alta", label: "Alta" },
  { value: "media", label: "Média" },
  { value: "baixa", label: "Baixa" },
];

export function FiltersPanel({ filters, onChange, onClear, open, id, hasProfile, savedSearch }: Props) {
  const seniority = filters.seniority ?? [];
  const chance = hasProfile ? filters.chance?.[0] : undefined;

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

      <fieldset className="flex flex-col" disabled={!hasProfile}>
        <legend className={LEGEND}>Chance</legend>
        {CHANCES.map((c) => (
          <label key={c.label} className={cn(OPTION, !hasProfile && "text-jf-ink-3")}>
            <input
              type="radio"
              name="chance"
              className={CONTROL}
              checked={chance === c.value}
              onChange={() => onChange({ chance: c.value ? [c.value] : undefined })}
            />
            {c.label === "Qualquer" ? c.label : `Chance: ${c.label}`}
          </label>
        ))}
        {!hasProfile && (
          <HardLink href="/perfil" className="mt-1 inline-flex min-h-11 items-center text-sm text-jf-brand hover:text-jf-brand-dark">
            Importe seu currículo
          </HardLink>
        )}
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
          onChange={(e) => onChange({ lang: (e.target.value || undefined) as PageFilters["lang"] })}
        >
          <option value="">Qualquer</option>
          {Object.entries(LANGUAGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className={OPTION}>
        <input
          type="checkbox"
          className={CONTROL}
          checked={filters.showHidden === true}
          onChange={(e) => onChange({ showHidden: e.target.checked ? true : undefined })}
        />
        Mostrar vagas ocultas
      </label>

      <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-jf-ink-2">
        Fonte
        <select
          className={FIELD}
          value={filters.source?.[0] ?? ""}
          onChange={(e) => onChange({ source: e.target.value ? [e.target.value as SourceId] : undefined })}
        >
          <option value="">Todas as fontes</option>
          {FILTERABLE_SOURCES.map((value) => (
            <option key={value} value={value}>
              {SOURCE_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1 border-t border-jf-line pt-4">
        <button
          type="button"
          disabled={!savedSearch.canSave}
          onClick={savedSearch.onSave}
          className="min-h-11 rounded-lg border border-jf-line-strong bg-jf-surface px-3 text-sm font-semibold outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-jf-brand disabled:opacity-60 disabled:hover:bg-jf-surface"
        >
          Salvar como busca padrão
        </button>
        <div aria-live="polite" className="flex flex-wrap items-center justify-between gap-x-3">
          {savedSearch.active && (
            <>
              <span className="text-[13px] text-jf-ink-2">Busca padrão ativa</span>
              <button
                type="button"
                onClick={savedSearch.onClear}
                className="min-h-11 text-sm text-jf-brand outline-none hover:text-jf-brand-dark focus-visible:ring-2 focus-visible:ring-jf-brand"
              >
                Remover busca padrão
              </button>
            </>
          )}
        </div>
        {savedSearch.error && (
          <p role="alert" className="text-[13px] text-jf-danger-fg">
            {savedSearch.error}
          </p>
        )}
      </div>
    </aside>
  );
}
