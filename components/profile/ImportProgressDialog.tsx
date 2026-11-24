"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BTN_OUTLINE } from "@/components/ui/styles";
import type { ImportPhase } from "@/lib/client/profile/import-progress";

type Props = {
  open: boolean;
  /** "done" não aparece: o modal fecha antes. */
  phase: ImportPhase;
  /** Inteiro de 0 a 100, estimado (ver `import-progress.ts`). */
  percent: number;
  found: string | null;
  onCancel: () => void;
};

const STEPS = ["Ler o arquivo", "Consultar a IA", "Conferir o resultado"] as const;

function stepIndex(phase: ImportPhase): number {
  if (phase === "reading") return 0;
  if (phase === "done") return 2;
  return 1;
}

export function stageLabel(phase: ImportPhase): string {
  return phase === "reading" ? "Lendo o arquivo..." : "Estruturando o currículo com IA...";
}

/** Modal com etapas e porcentagem da importação do CV (spec 2026-11-24-modal-progresso-importacao, D-03). */
export function ImportProgressDialog({ open, phase, percent, found, onCancel }: Props) {
  const current = stepIndex(phase);
  const label = stageLabel(phase);
  return (
    <Dialog open={open} disablePointerDismissal onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg">Importando seu currículo</DialogTitle>
          <DialogDescription className="text-sm text-jf-ink-2">
            A IA está lendo e organizando seu currículo. Isso leva alguns segundos.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex flex-col gap-2 text-sm">
          {STEPS.map((s, i) => {
            const state = i < current ? "done" : i === current ? "current" : "pending";
            return (
              <li key={s} aria-current={state === "current" ? "step" : undefined} className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                    state === "done"
                      ? "bg-jf-brand-soft text-jf-brand"
                      : state === "current"
                        ? "border-2 border-jf-brand text-jf-brand"
                        : "border border-jf-line-strong text-jf-ink-3"
                  }`}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span className={state === "pending" ? "text-jf-ink-3" : state === "current" ? "font-semibold" : "text-jf-ink-2"}>
                  {s}
                  {state === "done" && <span className="sr-only"> (concluído)</span>}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <p aria-live="polite" className="text-sm text-jf-ink-2">
              {label}
            </p>
            <span aria-hidden="true" className="text-2xl font-semibold tabular-nums">
              {percent}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Progresso da importação"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-valuetext={`cerca de ${percent}%, ${label}`}
            className="h-2.5 w-full overflow-hidden rounded-full bg-jf-surface-2"
          >
            <div
              className="h-full rounded-full bg-jf-brand transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: `${percent}%` }}
            />
          </div>
          {found && <p className="text-[13px] text-jf-ink-2">{found}</p>}
        </div>

        <div className="flex justify-end">
          <button type="button" className={BTN_OUTLINE} onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
