"use client";

import { Star } from "lucide-react";
import { useState } from "react";
import {
  JOB_STATUSES,
  STATUS_LABELS,
  appliedAt,
  setFavorite,
  setHidden,
  setStatus,
  useJobStates,
  type JobState,
  type JobStatus,
  type SnapshotSource,
} from "@/lib/client/jobs/job-state";
import type { SetResult } from "@/lib/client/storage/store";
import { BTN_OUTLINE } from "@/components/ui/styles";
import { cn } from "@/lib/utils";

const SAVE_ERROR = "Não foi possível salvar neste navegador.";

/** Mensagem curta quando o armazenamento recusa a gravação (cota cheia ou indisponível); some no próximo sucesso. */
function useSaveFeedback() {
  const [failed, setFailed] = useState(false);
  return {
    /** Registra o resultado da gravação e devolve se deu certo. */
    track: (r: SetResult) => {
      setFailed(!r.ok);
      return r.ok;
    },
    message: failed ? (
      <span role="alert" className="basis-full text-[13px] text-jf-danger-fg">
        {SAVE_ERROR}
      </span>
    ) : null,
  };
}

/** Estado da vaga lido do localStorage; `undefined` no pré-render e antes da hidratação. */
export function useJobState(id: number): JobState | undefined {
  return useJobStates()?.[String(id)];
}

const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

/** "23/11/2026", sempre no horário de Brasília. */
export function formatStatusDate(iso: string): string {
  return dateFormat.format(new Date(iso));
}

/** Selo de status da listagem; "Aplicada" mostra também a data. Nada sem status. */
export function StatusBadge({ state }: { state: JobState | undefined }) {
  if (!state || state.status === "none") return null;
  const date = appliedAt(state);
  return (
    <span
      data-testid="status-badge"
      className="rounded-md bg-jf-brand-soft px-2 py-0.5 text-xs font-semibold text-jf-brand-dark"
    >
      {STATUS_LABELS[state.status]}
      {date ? ` em ${formatStatusDate(date)}` : ""}
    </span>
  );
}

export function FavoriteButton({ job, className }: { job: SnapshotSource; className?: string }) {
  const favorite = useJobState(job.id)?.favorite ?? false;
  const feedback = useSaveFeedback();
  return (
    <>
      <button
        type="button"
        aria-pressed={favorite}
        aria-label={`Favoritar ${job.title}`}
        title={favorite ? "Remover dos favoritos" : "Favoritar"}
        onClick={() => feedback.track(setFavorite(job, !favorite))}
        className={cn(
          "inline-flex size-11 items-center justify-center rounded-lg border border-jf-line-strong bg-jf-surface outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-jf-brand",
          favorite ? "text-jf-fav" : "text-jf-ink-2",
          className,
        )}
      >
        <Star aria-hidden="true" className="size-5" fill={favorite ? "currentColor" : "none"} />
      </button>
      {feedback.message}
    </>
  );
}

/** Oculta (e, com `onHidden`, deixa a tela oferecer o "Desfazer"); numa vaga já oculta vira "Mostrar de novo". */
export function HideButton({
  job,
  onHidden,
  className,
}: {
  job: SnapshotSource;
  onHidden?: (job: SnapshotSource) => void;
  className?: string;
}) {
  const hidden = useJobState(job.id)?.hidden ?? false;
  const feedback = useSaveFeedback();
  return (
    <>
      <button
        type="button"
        aria-label={`${hidden ? "Mostrar de novo" : "Ocultar"} ${job.title}`}
        onClick={() => {
          if (feedback.track(setHidden(job, !hidden)) && !hidden) onHidden?.(job);
        }}
        className={cn(BTN_OUTLINE, "text-[13px]", className)}
      >
        {hidden ? "Mostrar de novo" : "Ocultar"}
      </button>
      {feedback.message}
    </>
  );
}

/** Ligações do menu "⋯" do card com o estado salvo; `feedback` é o aviso de gravação recusada. */
export function useJobMenuActions(job: SnapshotSource, onHidden?: (job: SnapshotSource) => void) {
  const state = useJobState(job.id);
  const feedback = useSaveFeedback();
  const hidden = state?.hidden ?? false;
  return {
    status: state?.status ?? null,
    hidden,
    changeStatus: (status: JobStatus) => {
      feedback.track(setStatus(job, status));
    },
    toggleHidden: () => {
      if (feedback.track(setHidden(job, !hidden)) && !hidden) onHidden?.(job);
    },
    feedback: feedback.message,
  };
}

export function StatusSelect({ job, className }: { job: SnapshotSource; className?: string }) {
  const status = useJobState(job.id)?.status ?? "none";
  const feedback = useSaveFeedback();
  return (
    <>
      <select
        aria-label={`Status da candidatura: ${job.title}`}
        value={status}
        onChange={(e) => feedback.track(setStatus(job, e.target.value as JobStatus))}
        className={cn(
          "min-h-11 rounded-lg border border-jf-line-strong bg-jf-surface px-2.5 text-[13px] text-jf-ink outline-none focus-visible:ring-2 focus-visible:ring-jf-brand",
          className,
        )}
      >
        {JOB_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {feedback.message}
    </>
  );
}
