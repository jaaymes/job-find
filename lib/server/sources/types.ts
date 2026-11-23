import "server-only";
import type { Seniority, SourceId, WorkMode } from "@/lib/shared/types/job";

/** Vaga já normalizada por um conector, antes do enriquecimento (a Tarefa 10 completa este arquivo). */
export type NormalizedJob = {
  externalId: string;
  url: string;
  title: string;
  company: string;
  companyLogoUrl: string | null;
  descriptionHtml: string;
  descriptionFormat: "html" | "markdown";
  country: string | null;
  city: string | null;
  locationText: string | null;
  eligibleRegions: string[];
  workModeHint: WorkMode | null;
  seniorityHint: Seniority | null;
  tags: string[];
  salary: {
    min: number | null;
    max: number | null;
    currency: string;
    period: "hour" | "month" | "year";
  } | null;
  publishedAt: Date | null;
};

/** Resposta do fetch seguro: o corpo já foi lido (com limite de bytes) antes de retornar. */
export type SafeResponse = {
  status: number;
  url: string;
  headers: Headers;
  text(): Promise<string>;
  json(): Promise<unknown>;
};

export type SafeFetch = (
  url: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<SafeResponse>;

export type ConnectorContext = {
  fetchJson: SafeFetch;
  fetchText: SafeFetch;
  cursor: string | null;
  setCursor(c: string | null): void;
  signal: AbortSignal;
  now: Date;
};

export type Connector = {
  id: SourceId;
  brazilian: boolean;
  fullSnapshot: boolean;
  minIntervalMinutes: number;
  /** Hosts liberados no fetch seguro desta fonte (URLs base fixas no código). */
  allowedHosts: string[];
  attribution: { label: string; url: string; dofollow: boolean };
  fetch: (ctx: ConnectorContext) => AsyncIterable<unknown>;
  /** Retorna `null` para vagas que não são de tecnologia (RN-01). */
  normalize: (raw: unknown) => NormalizedJob | null;
};
