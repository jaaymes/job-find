import { useState, useSyncExternalStore } from "react";
import { CLEAR_FILTERS, serializeFilters, type PageFilters } from "@/lib/client/jobs/use-jobs";

/** Desfaz a busca restaurada inteira, inclusive o texto (`q`), ao contrário do "Limpar tudo" dos chips. */
export function clearRestoredSearch(setFilters: (patch: PageFilters) => void) {
  setFilters(CLEAR_FILTERS);
}

const subscribeNever = () => () => {};
const MESSAGE = "Busca da última visita restaurada";

/**
 * O aviso vale enquanto os filtros restaurados não mudarem: no primeiro desvio ele é dispensado e não volta, nem se
 * o usuário restaurar o mesmo valor. Alternar "ocultas" não conta como desvio.
 */
export function useRestoredNoticeVisible(
  filters: PageFilters,
  restored: "last" | "saved" | null,
  ready: boolean,
): boolean {
  const { showHidden: _showHidden, ...rest } = filters;
  void _showHidden;
  const key = serializeFilters("", rest);
  const [baseKey, setBaseKey] = useState<string | null>(null);
  const [captured, setCaptured] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (ready && !captured) {
    setCaptured(true);
    if (restored === "last") setBaseKey(key);
  } else if (baseKey !== null && !dismissed && key !== baseKey) {
    setDismissed(true);
  }
  return baseKey !== null && !dismissed;
}

/**
 * Aviso discreto de que os filtros da última visita foram restaurados. A região de status existe sempre (vazia e `sr-only`, para não abrir espaço no layout) e o
 * texto entra num efeito depois da montagem, para o leitor de tela anunciá-lo.
 */
export function RestoredNotice({ visible, onClear }: { visible: boolean; onClear: () => void }) {
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const shown = mounted && visible;
  return (
    <p
      role="status"
      className={shown ? "m-0 flex flex-wrap items-center gap-x-2 text-[13px] text-jf-ink-2" : "sr-only"}
    >
      {shown && (
        <>
          {MESSAGE}
          <button
            type="button"
            onClick={onClear}
            className="inline-flex min-h-11 items-center rounded-md px-1 text-[13px] font-semibold text-jf-brand outline-none hover:text-jf-brand-dark focus-visible:ring-2 focus-visible:ring-jf-brand"
          >
            Limpar
          </button>
        </>
      )}
    </p>
  );
}
