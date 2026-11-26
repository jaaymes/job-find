"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { AssembledCv } from "@/lib/client/cv/assemble";
import { peekThumbnail, renderCvThumbnail } from "@/lib/client/pdf/thumbnail";
import type { CvTemplateId } from "@/lib/client/pdf/templates/types";
import { cn } from "@/lib/utils";

type Props = { cv: AssembledCv; templateId: CvTemplateId; width: number; className?: string };
type Result = { cv: AssembledCv; templateId: CvTemplateId; width: number; url: string | null };

const EDIT_DEBOUNCE_MS = 400;
const SHEET = "aspect-[210/297] w-full overflow-hidden rounded-md border border-jf-line bg-jf-surface";

/**
 * Folha A4 pequena com a página 1 do CV no modelo pedido. Só renderiza quando entra na tela
 * (sem `IntersectionObserver`, renderiza direto). O nome do modelo vem do rótulo ao redor: a imagem é decorativa.
 */
export function CvThumbnail({ cv, templateId, width, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (visible || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const matches = (r: Result | null): r is Result =>
    r !== null && r.cv === cv && r.templateId === templateId && r.width === width;
  // Já no cache (ex.: voltou ao idioma anterior): aparece na hora, sem renderizar nem esperar.
  const cached = visible && !matches(result) ? peekThumbnail(cv, templateId, width) : null;
  // Já houve imagem deste modelo e largura: troca de CV (edição no gerador) espera uma pausa antes de renderizar.
  const hadImage = result !== null && result.templateId === templateId && result.width === width;
  const hadImageRef = useRef(hadImage);
  useEffect(() => {
    hadImageRef.current = hadImage;
  });

  const latest = useRef({ cv, templateId, width });
  useEffect(() => {
    latest.current = { cv, templateId, width };
  });
  const retriedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!visible || cached !== null) return;
    let stale = false;
    // Ninguém mais quer esta miniatura (fechou a galeria, trocou o CV): o pedido sai da fila sem renderizar.
    const ctrl = new AbortController();
    const done = (url: string | null) => {
      if (!stale) setResult({ cv, templateId, width, url });
    };
    const timer = setTimeout(
      () => {
        renderCvThumbnail(cv, templateId, width, ctrl.signal).then(done, (err: unknown) => {
          // Cancelado não é falha: não vira "Prévia indisponível".
          if (!(err instanceof DOMException && err.name === "AbortError")) done(null);
        });
      },
      hadImageRef.current ? EDIT_DEBOUNCE_MS : 0,
    );
    return () => {
      stale = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [visible, cv, templateId, width, cached]);

  /** O cache pode revogar o URL de uma imagem ainda na tela: renderiza de novo uma única vez. */
  const onImageError = () => {
    const failing = cached ?? (matches(result) ? result.url : null);
    const key = `${templateId}:${width}:${failing}`;
    const own = { cv, templateId, width };
    const settle = (url: string | null) => {
      const now = latest.current;
      if (now.cv === own.cv && now.templateId === own.templateId && now.width === own.width) setResult({ ...own, url });
    };
    if (retriedFor.current === key) {
      settle(null);
      return;
    }
    renderCvThumbnail(cv, templateId, width).then(
      (url) => {
        retriedFor.current = `${templateId}:${width}:${url}`;
        // Mesmo URL de novo: a imagem não recarregaria, então não há o que tentar.
        settle(url === failing ? null : url);
      },
      () => settle(null),
    );
  };

  const url: string | null | undefined = matches(result) ? result.url : (cached ?? undefined);

  return (
    <div ref={ref} aria-hidden="true" className={cn("relative", className)}>
      {url === undefined ? (
        <Skeleton label="Carregando prévia" className={cn(SHEET, "bg-jf-chip")} />
      ) : url === null ? (
        <div className={cn(SHEET, "flex items-center justify-center p-2 text-center text-xs text-jf-ink-3")}>
          Prévia indisponível
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- object URL local; next/image não serve para blob:
        <img src={url} alt="" onError={onImageError} className={cn(SHEET, "object-cover object-top")} />
      )}
    </div>
  );
}
