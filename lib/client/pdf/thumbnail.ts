import "client-only";

import type { AssembledCv } from "@/lib/client/cv/assemble";
import type { CvTemplateId } from "./templates/types";

const MAX_CACHE = 20;

const cache = new Map<string, string>();
let tail: Promise<unknown> = Promise.resolve();

/** FNV-1a de 32 bits (sem dependência), em hexadecimal. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function thumbnailKey(cv: AssembledCv, templateId: CvTemplateId, widthPx: number): string {
  return `${templateId}:${widthPx}:${fnv1a(JSON.stringify(cv))}`;
}

async function renderPng(cv: AssembledCv, templateId: CvTemplateId, widthPx: number): Promise<string> {
  // O renderizador (@react-pdf) é pesado: só carrega na primeira miniatura, e este módulo fica leve.
  const { renderCvPdf } = await import("./render");
  const { blob } = await renderCvPdf(cv, templateId);
  const { getDocument } = await import("unpdf/pdfjs");
  const { drawPdfPage } = await import("./draw-page");
  const data = new Uint8Array(await blob.arrayBuffer());
  const task = getDocument({ data, useWasm: false, useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const canvas = document.createElement("canvas");
    await drawPdfPage(page, canvas, widthPx).promise;
    try {
      const png = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Falha ao gerar a miniatura."))), "image/png"),
      );
      return URL.createObjectURL(png);
    } finally {
      // Libera a memória do canvas temporário já (o navegador só a devolve quando o coletor passar).
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    void task.destroy().catch(() => undefined);
  }
}

/** URL da miniatura se já estiver no cache, sem renderizar (nem mexer na recência). */
export function peekThumbnail(cv: AssembledCv, templateId: CvTemplateId, widthPx: number): string | null {
  return cache.get(thumbnailKey(cv, templateId, widthPx)) ?? null;
}

function abortError(): DOMException {
  return new DOMException("Miniatura cancelada.", "AbortError");
}

/**
 * Miniatura (PNG da página 1) do CV no modelo pedido. Renderiza uma por vez (fila) e guarda até 20
 * no cache (o menos usado tem o URL revogado). Falhas rejeitam e não ficam no cache.
 *
 * `signal`: se for abortado antes de a vez do pedido chegar na fila, ele não renderiza e rejeita com `AbortError`
 * (sem cache). Cada chamada é um pedido próprio na fila (não há deduplicação): abortar um não afeta outro pedido
 * da mesma miniatura, que renderiza (ou acha no cache) normalmente. Abortar depois de a renderização começar não a
 * interrompe: ela termina e vai para o cache.
 */
export function renderCvThumbnail(
  cv: AssembledCv,
  templateId: CvTemplateId,
  widthPx: number,
  signal?: AbortSignal,
): Promise<string> {
  const key = thumbnailKey(cv, templateId, widthPx);
  const hit = cache.get(key);
  if (hit) {
    // Reinsere para marcar como usado agora: o despejo sai do menos usado (LRU), não do mais antigo.
    cache.delete(key);
    cache.set(key, hit);
    return Promise.resolve(hit);
  }

  const job = tail.then(async () => {
    const cached = cache.get(key);
    if (cached) return cached;
    if (signal?.aborted) throw abortError();
    const url = await renderPng(cv, templateId, widthPx);
    cache.set(key, url);
    if (cache.size > MAX_CACHE) {
      const oldest = cache.keys().next().value as string;
      const old = cache.get(oldest);
      cache.delete(oldest);
      if (old) URL.revokeObjectURL(old);
    }
    return url;
  });
  tail = job.catch(() => undefined);
  return job;
}

/** Só para testes. */
export function __resetThumbnailCache(): void {
  cache.clear();
  tail = Promise.resolve();
}
