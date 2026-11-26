"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { AssembledCv } from "@/lib/client/cv/assemble";
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

  // Já há imagem deste modelo e largura: troca de CV (edição no gerador) espera uma pausa antes de renderizar de novo.
  const hasImage = result !== null && result.templateId === templateId && result.width === width;
  const hasImageRef = useRef(hasImage);
  useEffect(() => {
    hasImageRef.current = hasImage;
  });

  useEffect(() => {
    if (!visible) return;
    let stale = false;
    const done = (url: string | null) => {
      if (!stale) setResult({ cv, templateId, width, url });
    };
    const timer = setTimeout(
      () => {
        // O renderizador é pesado: só carrega quando a primeira miniatura aparece.
        import("@/lib/client/pdf/thumbnail")
          .then((m) => m.renderCvThumbnail(cv, templateId, width))
          .then(done, () => done(null));
      },
      hasImageRef.current ? EDIT_DEBOUNCE_MS : 0,
    );
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [visible, cv, templateId, width]);

  // Outro modelo ou largura conta como "carregando"; outro CV mantém a imagem anterior até a nova ficar pronta.
  const current = hasImage ? result : null;

  return (
    <div ref={ref} aria-hidden="true" className={cn("relative", className)}>
      {current === null ? (
        <Skeleton label="Carregando prévia" className={cn(SHEET, "bg-jf-chip")} />
      ) : current.url === null ? (
        <div className={cn(SHEET, "flex items-center justify-center p-2 text-center text-xs text-jf-ink-3")}>
          Prévia indisponível
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- object URL local; next/image não serve para blob:
        <img src={current.url} alt="" className={cn(SHEET, "object-cover object-top")} />
      )}
    </div>
  );
}
