"use client";

import { SlidersHorizontal } from "lucide-react";
import { formatCount } from "./format";

type Props = {
  activeCount: number;
  /** `null` enquanto a contagem não chegou. */
  total: number | null;
  onOpenFilters: () => void;
};

/** Barra de resultados do celular e do tablet (abaixo de `lg`): fica fixa no topo ao rolar a lista. */
export function ResultsToolbar({ activeCount, total, onOpenFilters }: Props) {
  return (
    <div className="sticky top-0 z-30 -mx-4 flex items-center gap-2 border-b border-jf-line bg-jf-bg px-4 py-2 sm:-mx-6 sm:px-6 lg:hidden">
      <button
        type="button"
        onClick={onOpenFilters}
        aria-haspopup="dialog"
        className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-jf-field-border bg-jf-surface px-3.5 text-sm font-semibold text-jf-ink outline-none focus-visible:ring-2 focus-visible:ring-jf-brand"
      >
        <SlidersHorizontal aria-hidden="true" className="size-[18px]" />
        {activeCount > 0 ? `Filtros (${activeCount})` : "Filtros"}
      </button>
      {total !== null && (
        <span className="ml-auto text-[13px] text-jf-ink-3 tabular-nums" aria-live="polite">
          {formatCount(total, "vaga", "vagas")}
        </span>
      )}
    </div>
  );
}
