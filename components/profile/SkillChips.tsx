"use client";

import { useId, useState, type FormEvent } from "react";
import { normalizeSkill } from "@/lib/shared/stacks";
import type { Profile } from "@/lib/shared/schemas/profile";
import { BTN_OUTLINE, FIELD } from "@/components/ui/styles";

type Skill = Profile["skills"][number];

type Props = { skills: Skill[]; onChange: (skills: Skill[]) => void };

export function SkillChips({ skills, onChange }: Props) {
  const inputId = useId();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  function add(e: FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (!name) return;
    if (!skills.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      onChange([...skills, { name, years: null, stackId: normalizeSkill(name) }]);
    }
    setDraft("");
    setAdding(false);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-[15px] font-semibold">Competências</h3>
      <ul className="flex flex-wrap gap-2" aria-label="Competências">
        {skills.map((s, i) => (
          <li
            key={`${s.name}-${i}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-jf-line py-1 pr-1 pl-3 text-sm"
          >
            {s.name}
            {s.years !== null && (
              <span className="text-[13px] text-jf-ink-3">{s.years === 1 ? "1 ano" : `${s.years} anos`}</span>
            )}
            <button
              type="button"
              aria-label={`Remover ${s.name}`}
              onClick={() => onChange(skills.filter((_, j) => j !== i))}
              className="flex size-11 items-center justify-center rounded-full text-jf-ink-2 outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-jf-brand"
            >
              <span aria-hidden="true">×</span>
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <label htmlFor={inputId} className="text-[13px] font-semibold text-jf-ink-2">
              Nova competência
            </label>
            <input
              id={inputId}
              className={FIELD}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoComplete="off"
              autoFocus
            />
          </div>
          <button type="submit" className={BTN_OUTLINE}>
            Adicionar competência
          </button>
          <button
            type="button"
            className={BTN_OUTLINE}
            onClick={() => {
              setAdding(false);
              setDraft("");
            }}
          >
            Cancelar
          </button>
        </form>
      ) : (
        <button type="button" className={`${BTN_OUTLINE} w-fit rounded-full border-dashed`} onClick={() => setAdding(true)}>
          + Adicionar
        </button>
      )}
    </div>
  );
}
