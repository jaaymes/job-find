import "client-only";

import { APICallError } from "@ai-sdk/provider";
import type { ProviderId } from "./providers";

export type AiErrorCode =
  | "invalid_key"
  | "no_credit"
  | "budget"
  | "rate_limit"
  | "timeout"
  | "unavailable"
  | "no_provider"
  | "truncated"
  | "invalid_output"
  | "blocked_by_privacy"
  | "local_blocked";

/** Erro da camada de IA. `mapProviderError` converte erros de provedor em `AiError`. */
export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly retryable: boolean;
  readonly meta?: Record<string, unknown>;

  constructor(
    code: AiErrorCode,
    opts: { retryable?: boolean; meta?: Record<string, unknown>; message?: string; cause?: unknown } = {},
  ) {
    super(opts.message ?? code, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "AiError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.meta = opts.meta;
  }
}

/** Aborto do usuário (`AbortController`): deve ser repassado, nunca embrulhado como erro de IA. */
export function isAbortError(e: unknown): boolean {
  return errName(e) === "AbortError";
}

function errName(e: unknown): unknown {
  return typeof e === "object" && e !== null && "name" in e ? (e as { name?: unknown }).name : undefined;
}

function statusOf(e: unknown): number | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const o = e as { statusCode?: unknown; status?: unknown };
  if (typeof o.statusCode === "number") return o.statusCode;
  if (typeof o.status === "number") return o.status;
  return undefined;
}

/** Texto bruto da RESPOSTA (corpo/dados), só para procurar marcadores. Nunca inclui o corpo da requisição. */
function bodyText(e: unknown): string {
  if (!APICallError.isInstance(e)) return "";
  let data = "";
  try {
    data = e.data === undefined ? "" : JSON.stringify(e.data);
  } catch {
    data = "";
  }
  return `${e.responseBody ?? ""} ${data}`;
}

/** Trecho curto da resposta do provedor para a UI (ex.: mensagem de moderação). */
function excerptOf(body: string): string | undefined {
  const t = body.replace(/\s+/g, " ").trim().slice(0, 200);
  return t === "" ? undefined : t;
}

const RETRYABLE: ReadonlySet<AiErrorCode> = new Set(["rate_limit", "timeout", "unavailable"]);

/**
 * Converte um erro de provedor em `AiError`. Aborto do usuário (`AbortError`) é relançado como veio;
 * só `TimeoutError` (`AbortSignal.timeout`) vira `timeout`. Erros sem status HTTP (rede, CORS, erro no corpo
 * de uma resposta 200) viram `unavailable`; na IA local, falha de rede vira `local_blocked`.
 * O erro original não vira `cause` (o `APICallError` carrega o prompt em `requestBodyValues`).
 * `finish_reason: length` (`truncated`) é tratado em `generateStructured`, que vê o fim do stream.
 */
export function mapProviderError(e: unknown, ctx: { provider?: ProviderId } = {}): AiError {
  if (e instanceof AiError) return e;
  if (isAbortError(e)) throw e;
  const status = statusOf(e);
  const body = bodyText(e);
  const excerpt = excerptOf(body);
  const meta: Record<string, unknown> = { ...(status ? { status } : {}), ...(excerpt ? { excerpt } : {}) };
  const make = (code: AiErrorCode, retryable = RETRYABLE.has(code)) => new AiError(code, { retryable, meta });
  if (errName(e) === "TimeoutError") return make("timeout");
  const privacy = /data_collection|data policy/i.test(body);
  switch (status) {
    case 401:
      return make("invalid_key");
    case 402:
      return make("no_credit");
    case 403:
      return body.includes("limit_usd") ? make("budget") : make("invalid_key");
    case 429:
      return make("rate_limit");
    case 408:
      return make("timeout");
    case 404:
    case 503:
      if (privacy) return make("blocked_by_privacy");
      return make("unavailable", status === 503);
    default:
  }
  if (status !== undefined && status >= 500) return make("unavailable");
  // Outros 4xx (400, 404, 413, 422...): repetir não resolve.
  if (status !== undefined && status >= 400) return make("unavailable", false);
  if (status === undefined && ctx.provider === "local" && (e instanceof TypeError || APICallError.isInstance(e))) {
    return make("local_blocked");
  }
  // Sem status (rede, CORS, erro no corpo de uma resposta 200): tentar de novo pode resolver.
  return make("unavailable");
}
