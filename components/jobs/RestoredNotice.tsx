import { CLEAR_FILTERS, type PageFilters } from "@/lib/client/jobs/use-jobs";

/** Desfaz a busca restaurada inteira, inclusive o texto (`q`), ao contrário do "Limpar tudo" dos chips. */
export function clearRestoredSearch(setFilters: (patch: PageFilters) => void) {
  setFilters(CLEAR_FILTERS);
}

/** Aviso discreto de que os filtros da última visita foram restaurados. */
export function RestoredNotice({ onClear }: { onClear: () => void }) {
  return (
    <p role="status" className="m-0 flex flex-wrap items-center gap-x-2 text-[13px] text-jf-ink-2">
      Busca da última visita restaurada
      <button
        type="button"
        onClick={onClear}
        className="inline-flex min-h-11 items-center rounded-md px-1 text-[13px] font-semibold text-jf-brand outline-none hover:text-jf-brand-dark focus-visible:ring-2 focus-visible:ring-jf-brand"
      >
        Limpar
      </button>
    </p>
  );
}
