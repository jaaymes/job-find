"use client";

import { useRef, useState } from "react";
import { useJobStates, type JobState } from "@/lib/client/jobs/job-state";
import { cn } from "@/lib/utils";
import { Column } from "./Column";

type Tab = { id: string; label: string; empty: string; match: (s: JobState) => boolean };

const TABS: Tab[] = [
  { id: "favorites", label: "Favoritas", empty: "Você ainda não favoritou nenhuma vaga.", match: (s) => s.favorite },
  { id: "saved", label: "Salvas", empty: "Nenhuma vaga com status Salva.", match: (s) => s.status === "saved" },
  { id: "applied", label: "Aplicadas", empty: "Nenhuma vaga com status Aplicada.", match: (s) => s.status === "applied" },
  { id: "interview", label: "Entrevista", empty: "Nenhuma vaga em fase de entrevista.", match: (s) => s.status === "interview" },
  { id: "offer", label: "Proposta", empty: "Nenhuma vaga com proposta.", match: (s) => s.status === "offer" },
  { id: "rejected", label: "Recusadas", empty: "Nenhuma vaga com status Recusada.", match: (s) => s.status === "rejected" },
  { id: "hidden", label: "Ocultas", empty: "Você não ocultou nenhuma vaga.", match: (s) => s.hidden },
];

const byNewest = (a: JobState, b: JobState) => b.snapshot.publishedAt.localeCompare(a.snapshot.publishedAt);

function Skeleton() {
  return <div role="status" aria-label="Carregando" className="h-40 animate-pulse rounded-2xl border border-jf-line bg-jf-surface" />;
}

/** "Minhas vagas": uma aba por status (mais simples que um kanban no celular), com contador e sem chamar a API. */
export function Board() {
  const states = useJobStates();
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const all = states ? Object.values(states) : null;

  // Setas movem o foco e a seleção (padrão WAI-ARIA para abas).
  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0 && e.key !== "Home" && e.key !== "End") return;
    const target = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (index + step + TABS.length) % TABS.length;
    e.preventDefault();
    refs.current[target]?.focus();
    setActive(target);
  };

  const tab = TABS[active];
  const shown = all ? all.filter(tab.match).sort(byNewest) : null;

  return (
    <>
      <div>
        <h1 className="font-display text-[28px] font-bold tracking-tight sm:text-[34px]">Minhas vagas</h1>
        <p className="mt-1.5 text-jf-ink-3">
          Favoritas, candidaturas e vagas ocultas, guardadas só neste navegador. Continuam aqui mesmo depois de saírem
          da lista pública.
        </p>
      </div>

      <div role="tablist" aria-label="Minhas vagas por status" className="flex overflow-x-auto border-b border-jf-line sm:gap-1.5">
        {TABS.map((t, i) => {
          const selected = i === active;
          const count = all ? all.filter(t.match).length : null;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              role="tab"
              type="button"
              id={`my-tab-${t.id}`}
              aria-selected={selected}
              aria-controls="my-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "min-h-11 shrink-0 border-b-[3px] px-3 text-sm whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-jf-brand sm:px-4 sm:text-[15px]",
                selected ? "border-jf-ink font-semibold text-jf-ink" : "border-transparent text-jf-ink-2 hover:text-jf-ink",
              )}
            >
              {t.label}
              {count !== null && <span className="ml-1.5 text-jf-ink-3">{count}</span>}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id="my-panel" aria-labelledby={`my-tab-${tab.id}`}>
        {shown ? <Column jobs={shown} empty={tab.empty} /> : <Skeleton />}
      </div>
    </>
  );
}
