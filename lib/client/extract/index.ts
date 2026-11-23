import "client-only";

// Extração de texto de currículo (PDF/DOCX) 100% no navegador (D-12, SEC-09).
// As libs entram por import() dinâmico para não pesar o bundle inicial.

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_PAGES = 10;
export const MAX_CHARS = 30_000;
export const TIMEOUT_MS = 15_000;
/** Teto de expansão de um DOCX (soma dos tamanhos descomprimidos declarados). */
export const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1_000;
// Regras de PDF escaneado (D-12).
const SCANNED_MIN_CHARS = 200;
const SCANNED_MIN_CHARS_PER_PAGE = 100;
const SCANNED_MAX_INVALID_RATIO = 0.3;

export type ExtractErrorCode = "too_large" | "bad_type" | "too_many_pages" | "timeout" | "empty";

export class ExtractError extends Error {
  readonly code: ExtractErrorCode;
  constructor(code: ExtractErrorCode, message: string = code) {
    super(message);
    this.name = "ExtractError";
    this.code = code;
  }
}

export type ExtractResult = { kind: "pdf" | "docx"; text: string; pages: number; scanned: boolean };

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

async function readBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(new Uint8Array(r.result as ArrayBuffer));
    r.onerror = () => rej(new ExtractError("bad_type"));
    r.readAsArrayBuffer(file);
  });
}

/** Soma os tamanhos descomprimidos declarados no diretório central do ZIP, sem inflar nada. */
function assertZipSafe(b: Uint8Array): void {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ExtractError("bad_type");
  const entries = v.getUint16(eocd + 10, true);
  let off = v.getUint32(eocd + 16, true);
  if (entries > MAX_ZIP_ENTRIES) throw new ExtractError("too_large");
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (off + 46 > b.length || v.getUint32(off, true) !== 0x02014b50) throw new ExtractError("bad_type");
    total += v.getUint32(off + 24, true);
    if (total > MAX_UNZIPPED_BYTES) throw new ExtractError("too_large");
    off += 46 + v.getUint16(off + 28, true) + v.getUint16(off + 30, true) + v.getUint16(off + 32, true);
  }
}

function invalidRatio(text: string): number {
  if (!text.length) return 1;
  const bad = text.match(/[�\u0000-\u0008\u000B\u000C\u000E-\u001F]/g)?.length ?? 0;
  return bad / text.length;
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractResult> {
  const { getDocumentProxy, extractText: pdfText } = await import("unpdf");
  // O pdf.js embutido no unpdf não usa eval/new Function, então roda sob a CSP sem 'unsafe-eval'.
  const pdf = await getDocumentProxy(bytes);
  try {
    if (pdf.numPages < 1) throw new ExtractError("empty");
    if (pdf.numPages > MAX_PAGES) throw new ExtractError("too_many_pages");
    const { text } = await pdfText(pdf, { mergePages: true });
    const full = text.trim();
    const scanned =
      full.length < SCANNED_MIN_CHARS ||
      full.length / pdf.numPages < SCANNED_MIN_CHARS_PER_PAGE ||
      invalidRatio(full) > SCANNED_MAX_INVALID_RATIO;
    return { kind: "pdf", text: full.slice(0, MAX_CHARS), pages: pdf.numPages, scanned };
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

async function extractDocx(bytes: Uint8Array): Promise<ExtractResult> {
  assertZipSafe(bytes);
  const mammoth = await import("mammoth");
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const { value } = await mammoth.extractRawText({ arrayBuffer: copy });
  const text = value.trim();
  if (!text) throw new ExtractError("empty");
  return { kind: "docx", text: text.slice(0, MAX_CHARS), pages: 1, scanned: false };
}

export async function extractText(file: File): Promise<ExtractResult> {
  if (file.size > MAX_BYTES) throw new ExtractError("too_large");
  const name = file.name.toLowerCase();
  const kind = name.endsWith(".pdf") ? "pdf" : name.endsWith(".docx") ? "docx" : null;
  if (!kind) throw new ExtractError("bad_type");

  const bytes = await readBytes(file);
  if (bytes.length > MAX_BYTES) throw new ExtractError("too_large");
  const magicOk =
    kind === "pdf" ? startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) : startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  if (!magicOk) throw new ExtractError("bad_type");

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new ExtractError("timeout")), TIMEOUT_MS);
  });
  try {
    const work = kind === "pdf" ? extractPdf(bytes) : extractDocx(bytes);
    work.catch(() => undefined); // evita rejeição não tratada se o timeout vencer
    return await Promise.race([work, timeout]);
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    throw new ExtractError("bad_type", e instanceof Error ? e.message : "falha ao ler o arquivo");
  } finally {
    clearTimeout(timer);
  }
}
