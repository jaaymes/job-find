import { cn } from "@/lib/utils";

export type ChanceBand = "alta" | "media" | "baixa";

const BAND_STYLES: Record<ChanceBand, { label: string; className: string }> = {
  alta: { label: "Alta", className: "bg-jf-alta text-white" },
  media: { label: "Média", className: "bg-jf-media-bg text-jf-media-fg" },
  baixa: { label: "Baixa", className: "bg-jf-baixa-bg text-jf-baixa-fg" },
};

/** Chance de ser chamado. Sem perfil/currículo importado (`band: null`), só convida a importar. */
export function ChanceBadge({ band, score }: { band: ChanceBand | null; score?: number }) {
  if (band === null) {
    // Sem link: a tela de perfil ainda não existe.
    return (
      <span className="rounded-full bg-jf-baixa-bg px-3 py-1.5 text-[13px] whitespace-nowrap font-medium text-jf-ink-3">
        Importe seu currículo para ver
      </span>
    );
  }
  const { label, className } = BAND_STYLES[band];
  return (
    <span className={cn("rounded-full px-3 py-1.5 text-sm font-semibold whitespace-nowrap", className)} data-band={band}>
      {label}
      {score !== undefined ? ` · ${Math.round(score)}%` : ""}
    </span>
  );
}
