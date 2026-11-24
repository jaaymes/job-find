import { cn } from "@/lib/utils";
import { HardLink } from "@/components/ui/hard-link";

export type ChanceBand = "alta" | "media" | "baixa";

const BAND_STYLES: Record<ChanceBand, { label: string; className: string }> = {
  alta: { label: "Alta", className: "bg-jf-alta text-jf-surface" },
  media: { label: "Média", className: "bg-jf-media-bg text-jf-media-fg" },
  baixa: { label: "Baixa", className: "bg-jf-baixa-bg text-jf-baixa-fg" },
};

/** Chance de ser chamado. Sem perfil/currículo importado (`band: null`), só convida a importar. */
export function ChanceBadge({ band, score }: { band: ChanceBand | null; score?: number }) {
  if (band === null) {
    return (
      <HardLink
        href="/perfil"
        className="inline-flex min-h-11 items-center rounded-full bg-jf-baixa-bg px-3 text-[13px] font-medium whitespace-nowrap text-jf-ink-3 no-underline outline-none hover:text-jf-brand-dark hover:underline focus-visible:ring-2 focus-visible:ring-jf-brand"
      >
        Importe seu currículo para ver
      </HardLink>
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
