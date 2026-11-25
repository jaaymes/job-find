"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AssembledCv } from "@/lib/client/cv/assemble";
import { useMediaQuery } from "@/lib/client/use-media-query";

const DEBOUNCE_MS = 500;
const PREVIEW_BOX = "h-[70vh] min-h-[420px] w-full rounded-xl border border-jf-line bg-jf-surface";
const OPEN_LINK =
  "inline-flex min-h-11 items-center font-semibold text-jf-brand underline outline-none hover:text-jf-brand-dark focus-visible:ring-2 focus-visible:ring-jf-brand";

type PdfDoc = Awaited<ReturnType<typeof import("unpdf/pdfjs").getDocument>["promise"]>;
export type PreviewMode = "iframe" | "canvas";

function OpenPdfLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={OPEN_LINK}>
      Abrir PDF em tela cheia
      <span className="sr-only"> (abre em nova aba)</span>
    </a>
  );
}

/** Desenha cada página do PDF num `<canvas>` na largura do contêiner (nítido em telas de alta densidade). */
function PageCanvases({ doc, url, onFail }: { doc: PdfDoc; url: string; onFail: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const total = doc.numPages;

  useEffect(() => {
    let stale = false;
    const tasks: { cancel: () => void }[] = [];
    void (async () => {
      try {
        const dpr = window.devicePixelRatio || 1;
        for (let n = 1; n <= total; n++) {
          const canvas = canvasRefs.current[n - 1];
          if (!canvas || stale) return;
          const page = await doc.getPage(n);
          if (stale) return;
          const base = page.getViewport({ scale: 1 });
          const width = wrapRef.current?.clientWidth || base.width;
          const viewport = page.getViewport({ scale: (width / base.width) * dpr });
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const task = page.render({ canvas, viewport });
          tasks.push(task);
          await task.promise;
        }
      } catch {
        if (!stale) onFail();
      }
    })();
    return () => {
      stale = true;
      for (const t of tasks) t.cancel();
    };
  }, [doc, total, onFail]);

  return (
    <div ref={wrapRef} className="flex flex-col gap-3">
      {Array.from({ length: total }, (_, i) => (
        <figure key={i} className="m-0 flex flex-col gap-1.5">
          <canvas
            ref={(el) => {
              canvasRefs.current[i] = el;
            }}
            role="img"
            aria-label={`Página ${i + 1} do PDF`}
            className="h-auto w-full rounded-md border border-jf-line bg-jf-surface shadow-[0_8px_24px_rgba(21,23,28,0.10)]"
          />
          <figcaption className="text-center text-[13px] text-jf-ink-3">
            Página {i + 1} de {total}
          </figcaption>
        </figure>
      ))}
      <p className="m-0 text-center text-[13px] text-jf-ink-2">
        <OpenPdfLink url={url} />
      </p>
    </div>
  );
}

/** Modo canvas: abre o PDF com o pdf.js (o mesmo `unpdf/pdfjs` da extração) e cai para o link se falhar. */
function CanvasPreview({ blob, url }: { blob: Blob; url: string }) {
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [failed, setFailed] = useState(false);
  const fail = useCallback(() => setFailed(true), []);

  useEffect(() => {
    let stale = false;
    let opened: { destroy: () => Promise<void> } | null = null;
    void (async () => {
      try {
        const { getDocument } = await import("unpdf/pdfjs");
        const data = new Uint8Array(await blob.arrayBuffer());
        const task = getDocument({ data, useWasm: false, useSystemFonts: true });
        opened = task;
        const pdf = await task.promise;
        if (stale) return;
        setDoc(pdf);
      } catch {
        if (!stale) setFailed(true);
      }
    })();
    return () => {
      stale = true;
      void opened?.destroy().catch(() => undefined);
    };
  }, [blob]);

  if (failed) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2 text-sm text-jf-ink-2">
        <p>Não foi possível desenhar a pré-visualização aqui. Abra o PDF em tela cheia para conferir.</p>
        <OpenPdfLink url={url} />
      </div>
    );
  }
  if (!doc) {
    return (
      <div role="status" className="flex min-h-[420px] w-full items-center justify-center rounded-xl border border-jf-line bg-jf-surface text-sm text-jf-ink-3">
        Montando a pré-visualização…
      </div>
    );
  }
  return <PageCanvases doc={doc} url={url} onFail={fail} />;
}

/**
 * Pré-visualização do PDF (iframe `blob:` em telas largas, canvas no celular) (a CSP libera `frame-src blob:`). O PDF é regerado 500 ms depois da
 * última mudança; a URL antiga é revogada. Com `letter`, mostra a carta; sem ela, o CV (e informa o nº de páginas).
 * O renderizador (@react-pdf, WASM) só é carregado por `import()`.
 */
export function PdfPreview({
  cv,
  letter,
  onPages,
  mode,
}: {
  cv: AssembledCv;
  letter: string | null;
  onPages?: (pages: number) => void;
  /** Padrão: `canvas` abaixo de `lg` (iframe de PDF não rola direito no celular) e `iframe` a partir de `lg`. */
  mode?: PreviewMode;
}) {
  const wide = useMediaQuery("(min-width: 1024px)");
  const shown: PreviewMode = mode ?? (wide ? "iframe" : "canvas");
  const [file, setFile] = useState<{ url: string; blob: Blob } | null>(null);
  const [failed, setFailed] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const render = await import("@/lib/client/pdf/render");
          const result = letter !== null ? await render.renderLetterPdf(letter, cv) : await render.renderCvPdf(cv);
          if (stale) return;
          const next = URL.createObjectURL(result.blob);
          const old = urlRef.current;
          urlRef.current = next;
          setFile({ url: next, blob: result.blob });
          setFailed(false);
          if (old) URL.revokeObjectURL(old);
          if (letter === null) onPages?.(result.pages);
        } catch {
          if (!stale) setFailed(true);
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [cv, letter, onPages]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    [],
  );

  return (
    <div className="flex flex-col gap-2">
      {failed && (
        <p role="alert" className="text-sm text-jf-danger-fg">
          Não foi possível montar a pré-visualização. O botão de baixar ainda tenta gerar o PDF.
        </p>
      )}
      {file ? (
        shown === "canvas" ? (
          <CanvasPreview key={file.url} blob={file.blob} url={file.url} />
        ) : (
          <iframe title="Pré-visualização do PDF" src={file.url} className={PREVIEW_BOX} />
        )
      ) : (
        <div role="status" className={`flex items-center justify-center text-sm text-jf-ink-3 ${PREVIEW_BOX}`}>
          Montando a pré-visualização…
        </div>
      )}
    </div>
  );
}
