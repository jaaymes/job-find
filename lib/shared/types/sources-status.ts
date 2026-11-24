import type { SourceId } from "@/lib/shared/types/job";

/** Falhas seguidas a partir das quais uma fonte é exibida como `failing`. */
export const FAILING_THRESHOLD = 3;

export type SourceLastRun = {
  /** ISO 8601. */
  startedAt: string;
  status: "running" | "ok" | "error" | "skipped";
  fetched: number | null;
  inserted: number | null;
};

/** Piso, em minutos, do tempo sem coleta com sucesso a partir do qual uma fonte é considerada parada. */
export const MIN_STALE_AFTER_MINUTES = 180;

/** Margem, em minutos, somada ao intervalo mínimo de coleta da fonte. */
export const STALE_MARGIN_MINUTES = 60;

/** Limite de "coleta parada" de uma fonte: `max(180, intervalo mínimo + 60)` minutos. */
export function staleAfterMinutes(minIntervalMinutes: number): number {
  return Math.max(MIN_STALE_AFTER_MINUTES, minIntervalMinutes + STALE_MARGIN_MINUTES);
}

export type SourceStatus = {
  source: SourceId;
  label: string;
  attributionUrl: string;
  dofollow: boolean;
  status: "ok" | "failing";
  /** ISO 8601; `null` quando a fonte nunca coletou com sucesso. */
  lastSuccessAt: string | null;
  /** Minutos sem coleta com sucesso a partir dos quais a coleta da fonte é considerada parada. */
  staleAfterMinutes: number;
  /** Última execução registrada; o texto de erro nunca é exposto. */
  lastRun: SourceLastRun | null;
};

export type SourcesStatusResponse = { sources: SourceStatus[] };
