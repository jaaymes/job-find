import { cn } from "@/lib/utils";

export type ChanceBand = "alta" | "media" | "baixa";

const BAND_STYLES: Record<ChanceBand, { label: string; className: string }> = {
  alta: { label: "Alta", className: "bg-jf-alta text-jf-surface" },
  media: { label: "Média", className: "bg-jf-media-bg text-jf-media-fg" },
  baixa: { label: "Baixa", className: "bg-jf-baixa-bg text-jf-baixa-fg" },
};

/** Chance de ser chamado. Sem perfil (`band: null`) não mostra nada: o convite único fica no `SetupProgress`. */
export function ChanceBadge({ band, score }: { band: ChanceBand | null; score?: number }) {
  if (band === null) return null;
  const { label, className } = BAND_STYLES[band];
  return (
    <span className={cn("rounded-full px-3 py-1.5 text-sm font-semibold whitespace-nowrap", className)} data-band={band}>
      {label}
      {score !== undefined ? ` · ${Math.round(score)}%` : ""}
    </span>
  );
}
