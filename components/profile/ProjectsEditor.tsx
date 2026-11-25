"use client";

import { useRef, useState } from "react";
import type { Profile } from "@/lib/shared/schemas/profile";
import { BTN_OUTLINE, CARD, FIELD, FIELD_LABEL } from "@/components/ui/styles";
import { maxSeq, nextSeq } from "./ids";

type Project = Profile["projects"][number];

type Props = { projects: Project[]; onChange: (projects: Project[]) => void };

const orNull = (v: string): string | null => (v.trim() === "" ? null : v);

function Row({
  item,
  onChange,
  onRemove,
  startOpen,
}: {
  item: Project;
  onChange: (p: Project) => void;
  onRemove: () => void;
  startOpen: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const seenBullet = useRef(maxSeq(item.bullets.map((b) => b.id), /\.b(\d+)$/));
  // Texto cru das tecnologias: separar por vírgula a cada tecla apagaria vírgulas e espaços digitados.
  const [stacksText, setStacksText] = useState(item.stacks.join(", "));
  const set = (patch: Partial<Project>) => onChange({ ...item, ...patch });
  const title = item.name || "Novo projeto";

  return (
    <li className={`${CARD} flex flex-col gap-2 rounded-xl p-4`}>
      <div className="flex flex-wrap justify-between gap-2">
        <strong>{title}</strong>
        {item.stacks.length > 0 && <span className="text-sm text-jf-ink-3">{item.stacks.join(", ")}</span>}
      </div>
      {!open && (
        <ul className="list-disc pl-[18px] text-sm leading-relaxed text-jf-ink-2">
          {item.bullets.map((b) => (
            <li key={b.id}>{b.text}</li>
          ))}
        </ul>
      )}
      {open && (
        <div className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={FIELD_LABEL}>
              Nome do projeto
              <input className={FIELD} value={item.name} onChange={(e) => set({ name: e.target.value })} />
            </label>
            <label className={FIELD_LABEL}>
              Link (opcional)
              <input
                className={FIELD}
                inputMode="url"
                value={item.link ?? ""}
                onChange={(e) => set({ link: orNull(e.target.value) })}
              />
            </label>
            <label className={`${FIELD_LABEL} sm:col-span-2`}>
              Tecnologias (separadas por vírgula)
              <input
                className={FIELD}
                value={stacksText}
                onChange={(e) => {
                  setStacksText(e.target.value);
                  set({
                    stacks: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  });
                }}
              />
            </label>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-semibold text-jf-ink-2">Realizações do projeto</legend>
            {item.bullets.map((b, i) => (
              <div key={b.id} className="flex items-start gap-2">
                <textarea
                  aria-label={`Realização do projeto ${i + 1}`}
                  rows={2}
                  className={FIELD}
                  value={b.text}
                  onChange={(e) =>
                    set({ bullets: item.bullets.map((x) => (x.id === b.id ? { ...x, text: e.target.value } : x)) })
                  }
                />
                <button
                  type="button"
                  className={`${BTN_OUTLINE} min-w-11`}
                  aria-label={`Remover realização do projeto ${i + 1}`}
                  onClick={() => set({ bullets: item.bullets.filter((x) => x.id !== b.id) })}
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            ))}
            <button
              type="button"
              className={`${BTN_OUTLINE} w-fit`}
              onClick={() => {
                // Ids já usados nunca são reaproveitados.
                const n = nextSeq(seenBullet, item.bullets.map((b) => b.id), /\.b(\d+)$/);
                set({ bullets: [...item.bullets, { id: `${item.id}.b${n}`, text: "" }] });
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
          className="min-h-11 min-w-11 rounded-lg px-3 text-sm font-medium text-jf-brand outline-none hover:bg-jf-brand-soft focus-visible:ring-2 focus-visible:ring-jf-brand"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Concluir edição" : "Editar projeto"}
          <span className="sr-only"> {title}</span>
        </button>
        <button
          type="button"
          className="min-h-11 min-w-11 rounded-lg px-3 text-sm font-medium text-jf-danger-fg outline-none hover:bg-jf-danger-bg focus-visible:ring-2 focus-visible:ring-jf-brand"
          onClick={onRemove}
        >
          Remover projeto<span className="sr-only"> {title}</span>
        </button>
      </div>
    </li>
  );
}

export function ProjectsEditor({ projects, onChange }: Props) {
  const [newId, setNewId] = useState<string | null>(null);
  const seenProj = useRef(maxSeq(projects.map((p) => p.id), /^proj_(\d+)$/));

  function add() {
    // Ids já usados nunca são reaproveitados (CVs antigos referenciam `proj_N`).
    const id = `proj_${nextSeq(seenProj, projects.map((p) => p.id), /^proj_(\d+)$/)}`;
    setNewId(id);
    onChange([...projects, { id, name: "", link: null, stacks: [], bullets: [] }]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Projetos</h3>
        <button type="button" className={BTN_OUTLINE} onClick={add}>
          Adicionar projeto
        </button>
      </div>
      <p className="text-sm text-jf-ink-3">Escreva os projetos no idioma em que vai se candidatar.</p>
      <ul className="flex flex-col gap-3">
        {projects.map((p) => (
          <Row
            key={p.id}
            item={p}
            startOpen={p.id === newId}
            onChange={(x) => onChange(projects.map((y) => (y.id === p.id ? x : y)))}
            onRemove={() => onChange(projects.filter((y) => y.id !== p.id))}
          />
        ))}
      </ul>
    </div>
  );
}
