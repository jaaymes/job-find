"use client";

import { HIDE_ON_TEXT_FOCUS } from "@/components/layout/hide-on-text-focus";
import { HardLink } from "@/components/ui/hard-link";
import { consumeListReturn } from "@/lib/client/jobs/list-href";
import type { SnapshotSource } from "@/lib/client/jobs/job-state";
import { cn } from "@/lib/utils";
import { FavoriteButton } from "./JobActions";

const SECONDARY =
  "inline-flex min-h-13 flex-none items-center justify-center rounded-xl border border-jf-field-border bg-jf-surface px-3.5 text-[15px] font-semibold text-jf-ink no-underline outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-jf-brand";

/**
 * Barra de ação fixa do detalhe da vaga no celular (abaixo de `md`): salvar, gerar CV e candidatar-se.
 * Some enquanto um campo de texto tem foco (o teclado já ocupa a tela); a página reserva o espaço no fim.
 */
export function JobDetailActionBar({
  jobId,
  job,
  applyUrl,
  sourceName,
  canGenerate,
}: {
  jobId: number;
  /** Dados da vaga para gravar o favorito. */
  job: SnapshotSource;
  /** URL segura da fonte; vazia quando a vaga não tem. */
  applyUrl: string;
  sourceName: string;
  canGenerate: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Ações da vaga"
      className={cn("fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t border-jf-line bg-jf-surface px-4 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(21,23,28,0.08)] md:hidden", HIDE_ON_TEXT_FOCUS)}
    >
      <FavoriteButton job={job} className="size-13 flex-none rounded-xl border-jf-field-border" />
      {canGenerate ? (
        <HardLink href={`/gerador/${jobId}`} onClick={() => consumeListReturn(jobId)} className={SECONDARY}>
          Gerar CV
        </HardLink>
      ) : (
        <button
          type="button"
          disabled
          aria-label="Gerar CV + carta · precisa do currículo"
          className={`${SECONDARY} cursor-not-allowed border-dashed text-jf-ink-3`}
        >
          Gerar CV
        </button>
      )}
      {applyUrl && (
        <a
          href={applyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-13 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-jf-brand px-3 text-base font-semibold whitespace-nowrap text-jf-on-brand no-underline outline-none hover:bg-jf-brand-dark focus-visible:ring-2 focus-visible:ring-jf-brand focus-visible:ring-offset-2"
        >
          Candidatar-se
          <span aria-hidden="true">↗</span>
          <span className="sr-only"> na {sourceName}</span>
          <span className="sr-only"> (abre em nova aba)</span>
        </a>
      )}
    </div>
  );
}
