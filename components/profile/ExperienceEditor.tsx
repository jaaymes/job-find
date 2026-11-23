"use client";

import { useState } from "react";
import type { Profile } from "@/lib/shared/schemas/profile";
import { BTN_OUTLINE, CARD, FIELD, FIELD_LABEL } from "./styles";

type Experience = Profile["experiences"][number];

type Props = { experiences: Experience[]; onChange: (experiences: Experience[]) => void };

function period(e: Experience): string {
  const start = e.startDate ?? "?";
  return `${start} – ${e.endDate ?? "atual"}`;
}

function Row({
  exp,
  onChange,
  onRemove,
  startOpen,
}: {
  exp: Experience;
  onChange: (e: Experience) => void;
  onRemove: () => void;
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const set = (patch: Partial<Experience>) => onChange({ ...exp, ...patch });
  const title = [exp.title, exp.company].filter(Boolean).join(" · ") || "Nova experiência";

  return (
    <li className={`${CARD} flex flex-col gap-2 rounded-xl p-4`}>
      <div className="flex flex-wrap justify-between gap-2">
        <strong>{title}</strong>
        <span className="text-sm text-jf-ink-3">{period(exp)}</span>
      </div>
      {!open && (
        <ul className="list-disc pl-[18px] text-sm leading-relaxed text-jf-ink-2">
          {exp.bullets.map((b) => (
            <li key={b.id}>{b.text}</li>
          ))}
        </ul>
      )}
      {open && (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={FIELD_LABEL}>
              Cargo
              <input className={FIELD} value={exp.title} onChange={(e) => set({ title: e.target.value })} />
            </label>
            <label className={FIELD_LABEL}>
              Empresa
              <input className={FIELD} value={exp.company} onChange={(e) => set({ company: e.target.value })} />
            </label>
            <label className={FIELD_LABEL}>
              Início (AAAA-MM)
              <input
                className={FIELD}
                value={exp.startDate ?? ""}
                onChange={(e) => set({ startDate: e.target.value || null })}
              />
            </label>
            <label className={FIELD_LABEL}>
              Fim (AAAA-MM; vazio = atual)
              <input className={FIELD} value={exp.endDate ?? ""} onChange={(e) => set({ endDate: e.target.value || null })} />
            </label>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-semibold text-jf-ink-2">Realizações</legend>
            {exp.bullets.map((b, i) => (
              <div key={b.id} className="flex items-start gap-2">
                <textarea
                  aria-label={`Realização ${i + 1}`}
                  rows={2}
                  className={FIELD}
                  value={b.text}
                  onChange={(e) =>
                    set({ bullets: exp.bullets.map((x) => (x.id === b.id ? { ...x, text: e.target.value } : x)) })
                  }
                />
                <button
                  type="button"
                  className={BTN_OUTLINE}
                  aria-label={`Remover realização ${i + 1}`}
                  onClick={() => set({ bullets: exp.bullets.filter((x) => x.id !== b.id) })}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            ))}
            <button
              type="button"
              className={`${BTN_OUTLINE} w-fit`}
              onClick={() => {
                const max = exp.bullets.reduce((m, b) => Math.max(m, Number(/\.b(\d+)$/.exec(b.id)?.[1] ?? 0)), 0);
                set({ bullets: [...exp.bullets, { id: `${exp.id}.b${max + 1}`, text: "" }] });
              }}
            >
              + Realização
            </button>
          </fieldset>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-expanded={open}
          className="min-h-11 rounded-lg px-3 text-sm font-medium text-jf-brand outline-none hover:bg-jf-brand-soft focus-visible:ring-2 focus-visible:ring-jf-brand"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Concluir edição" : "Editar experiência"}
          <span className="sr-only"> {title}</span>
        </button>
        <button
          type="button"
          className="min-h-11 rounded-lg px-3 text-sm font-medium text-jf-danger-fg outline-none hover:bg-jf-danger-bg focus-visible:ring-2 focus-visible:ring-jf-brand"
          onClick={onRemove}
        >
          Remover experiência<span className="sr-only"> {title}</span>
        </button>
      </div>
    </li>
  );
}

export function ExperienceEditor({ experiences, onChange }: Props) {
  const [newId, setNewId] = useState<string | null>(null);

  function add() {
    // Ids já usados nunca são reaproveitados (análises e CVs antigos referenciam `exp_N`).
    const max = experiences.reduce((m, e) => Math.max(m, Number(/^exp_(\d+)$/.exec(e.id)?.[1] ?? 0)), 0);
    const id = `exp_${max + 1}`;
    setNewId(id);
    onChange([...experiences, { id, company: "", title: "", startDate: null, endDate: null, bullets: [] }]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Experiências</h3>
        <button type="button" className={BTN_OUTLINE} onClick={add}>
          + Experiência
        </button>
      </div>
      <ul className="flex flex-col gap-3">
        {experiences.map((e) => (
          <Row
            key={e.id}
            exp={e}
            startOpen={e.id === newId}
            onChange={(x) => onChange(experiences.map((y) => (y.id === e.id ? x : y)))}
            onRemove={() => onChange(experiences.filter((y) => y.id !== e.id))}
          />
        ))}
      </ul>
    </div>
  );
}
