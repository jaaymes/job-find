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

export type SourceStatus = {
  source: SourceId;
  label: string;
  attributionUrl: string;
  dofollow: boolean;
  status: "ok" | "failing";
  /** ISO 8601; `null` quando a fonte nunca coletou com sucesso. */
  lastSuccessAt: string | null;
  /** Última execução registrada; o texto de erro nunca é exposto. */
  lastRun: SourceLastRun | null;
};

export type SourcesStatusResponse = { sources: SourceStatus[] };
