"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import type { JobsFilters } from "@/lib/client/jobs/use-jobs";

const SINCE_OPTIONS = [
  { value: "", label: "Qualquer período" },
  { value: "24h", label: "Últimas 24 h" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
] as const;

type Props = { filters: JobsFilters; onChange: (patch: JobsFilters) => void };

export function SearchBar({ filters, onChange }: Props) {
  const urlValue = filters.q ?? "";
  // Rascunho local; a URL só muda ao enviar. Reajusta quando a URL muda de fora (ex.: Limpar filtros).
  const [draft, setDraft] = useState(urlValue);
  const [seen, setSeen] = useState(urlValue);
  if (seen !== urlValue) {
    setSeen(urlValue);
    setDraft(urlValue);
  }

  return (
    <form
      role="search"
      className="flex flex-wrap items-stretch gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onChange({ q: draft.trim() || undefined });
      }}
    >
      <label className="flex min-h-12 flex-[999_1_260px] items-center gap-2.5 rounded-xl border border-jf-line-strong bg-jf-surface px-3.5 focus-within:ring-2 focus-within:ring-jf-brand sm:min-h-[52px] sm:flex-[999_1_420px] sm:px-4">
        <Search aria-hidden="true" className="size-5 shrink-0 text-jf-ink-3" />
        <span className="sr-only">Buscar vagas</span>
        <input
          type="search"
          name="q"
          value={draft}
          maxLength={100}
          placeholder="Cargo, empresa ou tecnologia"
          onChange={(e) => setDraft(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-jf-ink-3"
        />
      </label>
      <label className="flex min-h-12 flex-1 basis-40 flex-col justify-center rounded-xl border border-jf-line-strong bg-jf-surface px-3.5 py-1.5 focus-within:ring-2 focus-within:ring-jf-brand sm:min-h-[52px]">
        <span className="text-xs text-jf-ink-3">Publicadas</span>
        <select
          value={filters.since ?? ""}
          onChange={(e) => onChange({ since: (e.target.value || undefined) as JobsFilters["since"] })}
          className="bg-transparent outline-none"
        >
          {SINCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="min-h-12 rounded-xl bg-jf-brand px-6 font-semibold text-jf-on-brand outline-none hover:bg-jf-brand-dark focus-visible:ring-2 focus-visible:ring-jf-brand focus-visible:ring-offset-2 sm:min-h-[52px]"
      >
        Buscar
      </button>
    </form>
  );
}
