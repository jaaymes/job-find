import "client-only";
import {
  ExtractError,
  MAX_BYTES,
  TIMEOUT_MS,
  type ExtractKind,
  type ExtractErrorCode,
  type ExtractResult,
} from "./errors";

// Extração de texto de currículo (PDF/DOCX) 100% no navegador (D-12, SEC-09).
// O trabalho pesado roda num Web Worker por extração, encerrado no timeout, para que
// um arquivo malicioso (zip bomb, PDF patológico) não trave nem estoure a aba.
// As libs entram por import() dinâmico dentro do worker.

export * from "./errors";

/** Contrato mínimo do Worker (permite injetar um falso nos testes). */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessageerror: ((ev: unknown) => void) | null;
}

export type ExtractOptions = { createWorker?: () => WorkerLike; timeoutMs?: number };

const defaultWorker = (): WorkerLike =>
  new Worker(new URL("./extract.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;

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

function runInWorker(
  bytes: Uint8Array,
  kind: ExtractKind,
  { createWorker = defaultWorker, timeoutMs = TIMEOUT_MS }: ExtractOptions,
): Promise<ExtractResult> {
  return new Promise<ExtractResult>((resolve, reject) => {
    let worker: WorkerLike;
    try {
      worker = createWorker();
    } catch {
      reject(new ExtractError("failed", "worker indisponível"));
      return;
    }
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new ExtractError("timeout"))), timeoutMs);
    worker.onmessage = (ev) => {
      const d = ev.data as { ok: boolean; result?: ExtractResult; code?: ExtractErrorCode };
      finish(() => (d?.ok && d.result ? resolve(d.result) : reject(new ExtractError(d?.code ?? "failed"))));
    };
    worker.onerror = () => finish(() => reject(new ExtractError("failed", "falha no worker")));
    worker.onmessageerror = worker.onerror;
    const copy = bytes.slice(); // o buffer é transferido; mantém `bytes` intacto
    try {
      worker.postMessage({ kind, bytes: copy }, [copy.buffer]);
    } catch {
      finish(() => reject(new ExtractError("failed", "falha ao enviar ao worker")));
    }
  });
}

export async function extractText(file: File, options: ExtractOptions = {}): Promise<ExtractResult> {
  if (file.size > MAX_BYTES) throw new ExtractError("too_large");
  const name = file.name.toLowerCase();
  const kind: ExtractKind | null = name.endsWith(".pdf") ? "pdf" : name.endsWith(".docx") ? "docx" : null;
  if (!kind) throw new ExtractError("bad_type");

  const bytes = await readBytes(file);
  if (bytes.length > MAX_BYTES) throw new ExtractError("too_large");
  const magicOk =
    kind === "pdf" ? startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) : startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  if (!magicOk) throw new ExtractError("bad_type");

  return runInWorker(bytes, kind, options);
}
