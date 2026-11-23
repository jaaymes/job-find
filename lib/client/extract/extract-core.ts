// Lógica pura de extração (PDF/DOCX). Roda dentro do Web Worker (extract.worker.ts)
// e é testável direto. Não toca em DOM nem em window.
import {
  ExtractError,
  MAX_CHARS,
  MAX_PAGES,
  MAX_UNZIPPED_BYTES,
  MAX_ZIP_ENTRIES,
  type ExtractKind,
  type ExtractResult,
} from "./errors";

// Regras de PDF escaneado (D-12).
const SCANNED_MIN_CHARS = 200;
const SCANNED_MIN_CHARS_PER_PAGE = 100;
const SCANNED_MAX_INVALID_RATIO = 0.3;

/** Soma os tamanhos descomprimidos declarados no diretório central do ZIP, sem inflar nada. */
export function assertZipSafe(b: Uint8Array): void {
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
  // U+FFFD, controles e Private Use Area (fontes sem mapeamento Unicode).
  const bad = text.match(/[�\u0000-\u0008\u000B\u000C\u000E-\u001F-]/g)?.length ?? 0;
  return bad / text.length;
}

async function extractPdf(bytes: Uint8Array): Promise<ExtractResult> {
  // Importa o pdf.js direto (e não `getDocumentProxy` do unpdf): este sempre testa
  // `new WebAssembly.Module`, o que violaria a CSP sem 'wasm-unsafe-eval'.
  const [{ getDocument }, { extractText: pdfText }] = await Promise.all([import("unpdf/pdfjs"), import("unpdf")]);
  const task = getDocument({ data: bytes, useWasm: false, useSystemFonts: true });
  const pdf = await task.promise;
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
    await task.destroy().catch(() => undefined);
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

export async function extractCore(bytes: Uint8Array, kind: ExtractKind): Promise<ExtractResult> {
  try {
    return await (kind === "pdf" ? extractPdf(bytes) : extractDocx(bytes));
  } catch (e) {
    if (e instanceof ExtractError) throw e;
    throw new ExtractError("bad_type", e instanceof Error ? e.message : "falha ao ler o arquivo");
  }
}
