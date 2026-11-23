import "client-only";

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

/** Erro da camada de IA. O mapa de erros por provedor (`mapProviderError`) é da Tarefa 24. */
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
