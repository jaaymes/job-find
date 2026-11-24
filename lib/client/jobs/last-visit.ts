import "client-only";

import { useEffect, useSyncExternalStore } from "react";
import { createStore, type Store } from "@/lib/client/storage/store";
import { z } from "@/lib/shared/zod";

/** Instante (ISO) em que o usuário saiu da home pela última vez; `null` na primeira visita. */
export const lastVisitStore: Store<string | null> = createStore("jobfind:v1:lastVisit", z.iso.datetime().nullable(), {
  version: 1,
  initial: null,
});

let previous: number | null | undefined;

function readPrevious(): number | null {
  if (previous === undefined) {
    const iso = lastVisitStore.get();
    const t = iso === null ? NaN : Date.parse(iso);
    previous = Number.isFinite(t) ? t : null;
  }
  return previous;
}

const noopSubscribe = () => () => {};

/**
 * Visita anterior, lida uma única vez e mantida fixa na sessão (os selos "Nova" não mudam enquanto se navega).
 * `null` na primeira visita, no servidor e na hidratação.
 */
export function usePreviousVisit(): number | null {
  return useSyncExternalStore(noopSubscribe, readPrevious, () => null);
}

/** "Nova": publicada depois da visita anterior. Sem visita anterior (primeira vez) nada é nova. */
export function isNewSince(publishedAt: string, previousVisit: number | null): boolean {
  return previousVisit !== null && new Date(publishedAt).getTime() > previousVisit;
}

let pendingUnmountWrite: ReturnType<typeof setTimeout> | null = null;

/**
 * Grava a hora atual como última visita ao sair da página (`pagehide`), quando a aba fica oculta e quando a home
 * desmonta (navegação interna: fechar a aba na página da vaga também conta como sair da home). Não grava ao
 * montar: o valor lido por `usePreviousVisit` continua sendo o da visita anterior. A gravação da desmontagem é
 * adiada e cancelada se a home montar de novo (o StrictMode de desenvolvimento monta, desmonta e monta).
 */
export function useRecordVisit(): void {
  useEffect(() => {
    if (pendingUnmountWrite !== null) {
      clearTimeout(pendingUnmountWrite);
      pendingUnmountWrite = null;
    }
    const record = () => void lastVisitStore.set(new Date().toISOString());
    const onVisibility = () => {
      if (document.visibilityState === "hidden") record();
    };
    window.addEventListener("pagehide", record);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", record);
      document.removeEventListener("visibilitychange", onVisibility);
      pendingUnmountWrite = setTimeout(() => {
        pendingUnmountWrite = null;
        record();
      }, 0);
    };
  }, []);
}

/** Somente para testes: esquece a visita anterior já lida. */
export function resetPreviousVisitForTests(): void {
  previous = undefined;
}
