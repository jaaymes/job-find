"use client";

import { useEffect, useRef, useState } from "react";
import type { AssembledCv } from "@/lib/client/cv/assemble";

const DEBOUNCE_MS = 500;

/**
 * Pré-visualização do PDF num iframe `blob:` (a CSP libera `frame-src blob:`). O PDF é regerado 500 ms depois da
 * última mudança; a URL antiga é revogada. Com `letter`, mostra a carta; sem ela, o CV (e informa o nº de páginas).
 * O renderizador (@react-pdf, WASM) só é carregado por `import()`.
 */
export function PdfPreview({
  cv,
  letter,
  onPages,
}: {
  cv: AssembledCv;
  letter: string | null;
  onPages?: (pages: number) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
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
          setUrl(next);
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
      {url ? (
        <iframe title="Pré-visualização do PDF" src={url} className="h-[70vh] min-h-[420px] w-full rounded-xl border border-jf-line bg-jf-surface" />
      ) : (
        <div
          role="status"
          className="flex h-[70vh] min-h-[420px] w-full items-center justify-center rounded-xl border border-jf-line bg-jf-surface text-sm text-jf-ink-3"
        >
          Montando a pré-visualização…
        </div>
      )}
    </div>
  );
}
