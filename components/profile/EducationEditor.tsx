"use client";

import { useRef, useState } from "react";
import type { Profile } from "@/lib/shared/schemas/profile";
import { BTN_OUTLINE, CARD, FIELD, FIELD_LABEL } from "@/components/ui/styles";

type Education = Profile["education"][number];

type Props = { education: Education[]; onChange: (education: Education[]) => void };

const orNull = (v: string): string | null => (v.trim() === "" ? null : v);

function period(e: Education): string {
  if (!e.startYear && !e.endYear) return "";
  return `${e.startYear ?? "?"} – ${e.endYear ?? "atual"}`;
}

function Row({
  item,
  onChange,
  onRemove,
  startOpen,
}: {
  item: Education;
  onChange: (e: Education) => void;
  onRemove: () => void;
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const set = (patch: Partial<Education>) => onChange({ ...item, ...patch });
  const title = [item.degree, item.institution].filter(Boolean).join(" · ") || "Nova formação";

  return (
    <li className={`${CARD} flex flex-col gap-2 rounded-xl p-4`}>
      <div className="flex flex-wrap justify-between gap-2">
        <strong>{title}</strong>
        <span className="text-sm text-jf-ink-3">{period(item)}</span>
      </div>
      {open && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={FIELD_LABEL}>
            Instituição
            <input className={FIELD} value={item.institution} onChange={(e) => set({ institution: e.target.value })} />
          </label>
          <label className={FIELD_LABEL}>
            Curso ou grau
            <input
              className={FIELD}
              value={item.degree ?? ""}
              onChange={(e) => set({ degree: orNull(e.target.value) })}
            />
          </label>
          <label className={FIELD_LABEL}>
            Ano de início (AAAA)
            <input
              className={FIELD}
              inputMode="numeric"
              value={item.startYear ?? ""}
              onChange={(e) => set({ startYear: orNull(e.target.value) })}
            />
          </label>
          <label className={FIELD_LABEL}>
            Ano de conclusão (AAAA; vazio = em andamento)
            <input
              className={FIELD}
              inputMode="numeric"
              value={item.endYear ?? ""}
              onChange={(e) => set({ endYear: orNull(e.target.value) })}
            />
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-expanded={open}
          className="min-h-11 min-w-11 rounded-lg px-3 text-sm font-medium text-jf-brand outline-none hover:bg-jf-brand-soft focus-visible:ring-2 focus-visible:ring-jf-brand"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Concluir edição" : "Editar formação"}
          <span className="sr-only"> {title}</span>
        </button>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg px-3 text-sm font-medium text-jf-danger-fg outline-none hover:bg-jf-danger-bg focus-visible:ring-2 focus-visible:ring-jf-brand"
          onClick={onRemove}
        >
          Remover formação<span className="sr-only"> {title}</span>
        </button>
      </div>
    </li>
  );
}

export function EducationEditor({ education, onChange }: Props) {
  // A formação não tem id no schema: chaves locais estáveis evitam que a linha seguinte herde o estado da removida.
  const [keys, setKeys] = useState<number[]>(() => education.map((_, i) => i));
  const nextKey = useRef(education.length);
  const [newKey, setNewKey] = useState<number | null>(null);

  function add() {
    const key = nextKey.current++;
    setKeys((k) => [...k, key]);
    setNewKey(key);
    onChange([...education, { institution: "", degree: null, startYear: null, endYear: null }]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Formação</h3>
        <button type="button" className={BTN_OUTLINE} onClick={add}>
          + Formação
        </button>
      </div>
      <ul className="flex flex-col gap-3">
        {education.map((item, i) => (
          <Row
            key={keys[i] ?? `i${i}`}
            item={item}
            startOpen={keys[i] === newKey}
            onChange={(x) => onChange(education.map((y, j) => (j === i ? x : y)))}
            onRemove={() => {
              setKeys((k) => k.filter((_, j) => j !== i));
              onChange(education.filter((_, j) => j !== i));
            }}
          />
        ))}
      </ul>
    </div>
  );
}
