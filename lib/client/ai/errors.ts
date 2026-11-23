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
  return (
    typeof e === "object" && e !== null && "name" in e && (e as { name?: unknown }).name === "AbortError"
  );
}

function statusOf(e: unknown): number | undefined {
  if (typeof e !== "object" || e === null) return undefined;
  const o = e as { statusCode?: unknown; status?: unknown };
  if (typeof o.statusCode === "number") return o.statusCode;
  if (typeof o.status === "number") return o.status;
  return undefined;
}

/** Texto bruto do corpo/dados do erro, só para procurar marcadores (nunca vai para log nem para a UI). */
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

const RETRYABLE: ReadonlySet<AiErrorCode> = new Set(["rate_limit", "timeout", "unavailable"]);

/**
 * Converte um erro de provedor em `AiError`. Erros sem status HTTP (falha de rede, CORS, erro no corpo
 * de uma resposta 200) viram `unavailable`; na IA local, falha de rede vira `local_blocked`.
 * `finish_reason: length` (`truncated`) é tratado em `generateStructured`, que vê o fim do stream.
 */
export function mapProviderError(e: unknown, ctx: { provider?: ProviderId } = {}): AiError {
  if (e instanceof AiError) return e;
  const status = statusOf(e);
  const make = (code: AiErrorCode, meta?: Record<string, unknown>) =>
    new AiError(code, { retryable: RETRYABLE.has(code), meta: { ...(status ? { status } : {}), ...meta }, cause: e });
  if (isAbortError(e)) return make("timeout");
  const body = bodyText(e);
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
    case 503:
      if (body.includes("data_collection")) return make("blocked_by_privacy");
      return make("unavailable");
    default:
  }
  if (status !== undefined && status >= 500) return make("unavailable");
  if (status === undefined && ctx.provider === "local" && e instanceof TypeError) return make("local_blocked");
  if (status === undefined && ctx.provider === "local" && APICallError.isInstance(e)) return make("local_blocked");
  // Sem status (rede, CORS, erro no corpo de uma resposta 200) ou status inesperado: tenta de novo pode resolver.
  return new AiError("unavailable", { retryable: true, meta: status ? { status } : undefined, cause: e });
}
