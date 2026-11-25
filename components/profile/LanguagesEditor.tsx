"use client";

import { LANGUAGE_LEVEL_LABEL, LANGUAGE_LEVELS, type LanguageLevel, type Profile } from "@/lib/shared/schemas/profile";
import { BTN_OUTLINE, CARD, FIELD, FIELD_LABEL } from "@/components/ui/styles";

type Language = Profile["languages"][number];

type Props = { languages: Language[]; onChange: (languages: Language[]) => void };

export function LanguagesEditor({ languages, onChange }: Props) {
  const set = (i: number, patch: Partial<Language>) =>
    onChange(languages.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Idiomas</h3>
        <button
          type="button"
          className={BTN_OUTLINE}
          onClick={() => onChange([...languages, { name: "", level: "intermediate" }])}
        >
          Adicionar idioma
        </button>
      </div>
      <ul className="flex flex-col gap-3">
        {languages.map((l, i) => (
          <li key={i} className={`${CARD} flex flex-col gap-3 rounded-xl p-4`}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={FIELD_LABEL}>
                Idioma
                <input
                  aria-label={`Nome do idioma ${i + 1}`}
                  className={FIELD}
                  value={l.name}
                  onChange={(e) => set(i, { name: e.target.value })}
                />
              </label>
              <label className={FIELD_LABEL}>
                Nível
                <select
                  aria-label={`Nível do idioma ${i + 1}`}
                  className={FIELD}
                  value={l.level}
                  onChange={(e) => set(i, { level: e.target.value as LanguageLevel })}
                >
                  {LANGUAGE_LEVELS.map((lv) => (
                    <option key={lv} value={lv}>
                      {LANGUAGE_LEVEL_LABEL.pt[lv]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              className="min-h-11 w-fit rounded-lg px-3 text-sm font-medium text-jf-danger-fg outline-none hover:bg-jf-danger-bg focus-visible:ring-2 focus-visible:ring-jf-brand"
              onClick={() => onChange(languages.filter((_, j) => j !== i))}
            >
              Remover idioma<span className="sr-only"> {l.name || i + 1}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
