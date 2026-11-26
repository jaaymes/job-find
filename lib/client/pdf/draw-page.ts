export type PdfPage = Awaited<
  ReturnType<Awaited<ReturnType<typeof import("unpdf/pdfjs").getDocument>["promise"]>["getPage"]>
>;

/**
 * Desenha uma página do PDF num `<canvas>` na largura CSS pedida, escalando por `devicePixelRatio`
 * para ficar nítida em telas de alta densidade.
 */
export function drawPdfPage(
  page: PdfPage,
  canvas: HTMLCanvasElement,
  cssWidth: number,
): { promise: Promise<void>; cancel: () => void } {
  const dpr = window.devicePixelRatio || 1;
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const task = page.render({ canvas, viewport });
  return { promise: task.promise, cancel: () => task.cancel() };
}
