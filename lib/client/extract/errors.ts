import "client-only";

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_PAGES = 10;
export const MAX_CHARS = 30_000;
export const TIMEOUT_MS = 15_000;
/** Teto de expansão de um DOCX (soma dos tamanhos descomprimidos declarados). */
export const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 1_000;

export type ExtractErrorCode = "too_large" | "bad_type" | "too_many_pages" | "timeout" | "empty" | "failed";

export class ExtractError extends Error {
  readonly code: ExtractErrorCode;
  constructor(code: ExtractErrorCode, message: string = code) {
    super(message);
    this.name = "ExtractError";
    this.code = code;
  }
}

export type ExtractKind = "pdf" | "docx";
export type ExtractResult = { kind: ExtractKind; text: string; pages: number; scanned: boolean };
