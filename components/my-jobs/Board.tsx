"use client";

import { useRef, useState } from "react";
import { isSavedStage, useJobStates, type JobState } from "@/lib/client/jobs/job-state";
import { cn } from "@/lib/utils";
import { Column } from "./Column";
import { Skeleton } from "@/components/ui/skeleton";

export const STAGES = [
  { id: "saved", label: "Salvas" },
  { id: "applied", label: "Aplicadas" },
  { id: "interview", label: "Entrevista" },
  { id: "offer", label: "Proposta" },
] as const;

type StageId = (typeof STAGES)[number]["id"];
type Extra = "rejected" | "hidden";

const STAGE_META: Record<StageId, { match: (s: JobState) => boolean; dot: string; empty: string }> = {
  saved: {
    match: isSavedStage,
    dot: "bg-jf-ink-3",
    empty: "Nenhuma vaga salva. Favorite uma vaga ou mova uma para cá pelo botão Mover.",
  },
  applied: {
    match: (s) => s.status === "applied",
    dot: "bg-jf-brand",
    empty: "Nenhuma candidatura ainda. Mova uma vaga para cá pelo botão Mover quando se candidatar.",
  },
  interview: {
    match: (s) => s.status === "interview",
    dot: "bg-jf-warn-fg",
    empty: "Nenhuma entrevista ainda. Mova uma vaga para cá pelo botão Mover quando for chamada.",
  },
  offer: {
    match: (s) => s.status === "offer",
    dot: "bg-jf-alta",
    empty: "Nenhuma proposta ainda. Mova uma vaga para cá pelo botão Mover quando receber.",
  },
};

const EXTRAS: Record<Extra, { label: string; empty: string; match: (s: JobState) => boolean }> = {
  rejected: { label: "Recusadas", empty: "Nenhuma vaga com status Recusada.", match: (s) => s.status === "rejected" },
  hidden: { label: "Ocultas", empty: "Você não ocultou nenhuma vaga.", match: (s) => s.hidden },
};

const byNewest = (a: JobState, b: JobState) => b.snapshot.publishedAt.localeCompare(a.snapshot.publishedAt);

const LINK_BTN =
  "inline-flex min-h-11 items-center text-sm text-jf-brand-dark underline outline-none focus-visible:ring-2 focus-visible:ring-jf-brand";

function LoadingSkeleton() {
  return <Skeleton className="h-40 rounded-2xl border border-jf-line bg-jf-surface" />;
}

/** "Minhas vagas": funil Salvas → Aplicadas → Entrevista → Proposta (4 colunas no desktop, seletor segmentado no celular). */
export function Board() {
  const states = useJobStates();
  const [active, setActive] = useState(0);
  const [extra, setExtra] = useState<Extra | null>(null);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const all = states ? Object.values(states) : null;
  const visible = all ? (onlyFavorites ? all.filter((s) => s.favorite) : all) : null;

  // Setas movem o foco e a seleção (padrão WAI-ARIA para abas).
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0 && e.key !== "Home" && e.key !== "End") return;
    const last = STAGES.length - 1;
    const target = e.key === "Home" ? 0 : e.key === "End" ? last : (index + step + STAGES.length) % STAGES.length;
    e.preventDefault();
    refs.current[target]?.focus();
    setActive(target);
    setExtra(null);
  };

  const extraList = extra && visible ? visible.filter(EXTRAS[extra].match).sort(byNewest) : null;
  const extraCount = (k: Extra) => (visible ? visible.filter(EXTRAS[k].match).length : null);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4">
        <h1 className="flex-1 font-display text-[28px] font-bold tracking-tight sm:text-[34px]">Minhas vagas</h1>
        <label className="flex min-h-11 items-center gap-2 text-sm text-jf-ink-2">
          <input
            type="checkbox"
            checked={onlyFavorites}
            onChange={(e) => setOnlyFavorites(e.target.checked)}
            className="size-[18px] accent-jf-brand"
          />
          Só favoritas
        </label>
      </div>
      <p className="-mt-3 text-sm text-jf-ink-3">
        Seu funil de candidaturas. Mude o status pelo botão Mover de cada card. Tudo fica salvo só neste navegador.
      </p>

      <div
        role="tablist"
        aria-label="Etapa"
        className="grid grid-cols-4 gap-1 rounded-xl bg-jf-chip p-1 lg:hidden"
      >
        {STAGES.map((st, i) => {
          const selected = !extra && i === active;
          const count = visible ? visible.filter(STAGE_META[st.id].match).length : null;
          return (
            <button
              key={st.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="tab"
              type="button"
              id={`my-tab-${st.id}`}
              aria-selected={selected}
              aria-controls={`my-col-${st.id}`}
              tabIndex={selected || (extra !== null && i === active) ? 0 : -1}
              onClick={() => {
                setActive(i);
                setExtra(null);
              }}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "min-h-14 rounded-[9px] text-xs outline-none focus-visible:ring-2 focus-visible:ring-jf-brand",
                selected ? "bg-jf-surface font-semibold text-jf-ink" : "font-medium text-jf-ink-2",
              )}
            >
              <span className="block font-display text-[17px] font-bold tabular-nums">{count ?? "–"}</span>
              {st.label}
            </button>
          );
        })}
      </div>

      {extra ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 className="flex-1 text-lg font-semibold">{EXTRAS[extra].label}</h2>
            <button type="button" onClick={() => setExtra(null)} className={LINK_BTN}>
              Voltar ao funil
            </button>
          </div>
          {extraList ? (
            <Column
              id={`my-col-${extra}`}
              name={EXTRAS[extra].label}
              jobs={extraList}
              empty={EXTRAS[extra].empty}
              className="flex lg:border-0 lg:bg-transparent lg:p-0"
              grid
            />
          ) : (
            <LoadingSkeleton />
          )}
        </div>
      ) : visible ? (
        <div className="grid items-start gap-4 lg:grid-cols-4">
          {STAGES.map((st, i) => (
            <Column
              key={st.id}
              id={`my-col-${st.id}`}
              name={st.label}
              dot={STAGE_META[st.id].dot}
              jobs={visible.filter(STAGE_META[st.id].match).sort(byNewest)}
              empty={STAGE_META[st.id].empty}
              className={cn(i === active ? "flex" : "hidden lg:flex", "lg:min-h-[420px]")}
            />
          ))}
        </div>
      ) : (
        <LoadingSkeleton />
      )}

      <div className="flex flex-wrap items-center justify-center gap-x-6 lg:justify-start">
        {(Object.keys(EXTRAS) as Extra[]).map((k) => {
          const n = extraCount(k);
          return (
            <button key={k} type="button" aria-pressed={extra === k} onClick={() => setExtra(k)} className={LINK_BTN}>
              {EXTRAS[k].label}
              {n !== null ? ` (${n})` : ""}
            </button>
          );
        })}
      </div>
    </>
  );
}
