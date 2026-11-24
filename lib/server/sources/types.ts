import "server-only";
import type { Seniority, SourceId, WorkMode } from "@/lib/shared/types/job";

/** Empresa que os conectores usam quando a fonte não informa uma (GitHub issues, WWR). */
export const UNKNOWN_COMPANY = "Não informada";

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
  init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    /** Padrão GET. POST não segue redirect nem repete em 429/5xx (evita efeito duplicado). */
    method?: "GET" | "POST";
    body?: string;
  },
) => Promise<SafeResponse>;

export type ConnectorContext = {
  fetchJson: SafeFetch;
  fetchText: SafeFetch;
  cursor: string | null;
  setCursor(c: string | null): void;
  /**
   * Falha parcial que não derruba a fonte (ex.: um board fora do ar num conector multi-board).
   * O runner registra o resumo em `source_runs.error` e, nessa coleta, não conta coleta perdida
   * (`markMissedRuns`) da fonte inteira, porque o snapshot ficou incompleto, salvo quando o
   * conector reporta escopo (`reportScope`): aí só os boards do escopo contam.
   */
  reportPartial(label: string, error: unknown): void;
  /**
   * Prefixos de `externalId` dos boards lidos por completo nesta coleta (só os que vieram sem erro e
   * com vagas). Com escopo, o runner conta coleta perdida e expira só as vagas desses prefixos.
   */
  reportScope(prefixes: readonly string[]): void;
  /**
   * Prazo de busca da fonte em epoch ms: conectores em rodízio param de agendar requisições perto
   * dele. O runner já desconta a margem para a requisição em andamento e a gravação, então a fonte
   * inteira cabe no teto de 90 s.
   */
  deadlineAt: number;
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
  /** Limite de bytes por resposta no fetch seguro; sem ele vale o padrão de `createSafeFetch` (10 MB). */
  maxResponseBytes?: number;
  /**
   * Só para fontes incrementais (`fullSnapshot: false`) que revisitam o catálogo inteiro dentro
   * deste número de horas. Com ele, a coleta conta coleta perdida para as vagas da fonte não vistas
   * há mais que isso, e `expireJobs` as alcança como faz com as fontes de snapshot. Fontes que só
   * trazem as vagas mais novas e nunca revisitam as antigas (Himalayas, Jobicy, HN) não declaram.
   */
  revisitsCatalogWithinHours?: number;
  attribution: { label: string; url: string; dofollow: boolean };
  fetch: (ctx: ConnectorContext) => AsyncIterable<unknown>;
  /** Retorna `null` para vagas que não são de tecnologia (RN-01). */
  normalize: (raw: unknown) => NormalizedJob | null;
};
