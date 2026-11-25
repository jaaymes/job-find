import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Props = { className?: string; label?: string; children?: ReactNode };

/** Marcador de carregamento: anunciado como status e sem animação para quem pede movimento reduzido. */
export function Skeleton({ className, label, children }: Props) {
  return (
    <div role="status" aria-label={label ?? "Carregando"} className={cn("animate-pulse motion-reduce:animate-none", className)}>
      {children}
    </div>
  );
}
