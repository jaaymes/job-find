"use client";

import { suggestSkills } from "@/lib/client/profile/review";
import type { Profile } from "@/lib/shared/schemas/profile";
import { BTN_OUTLINE } from "@/components/ui/styles";

type Skill = Profile["skills"][number];

type Props = { profile: Profile; onAdd: (skill: Skill) => void };

/** Chips "+ React" com as stacks citadas nas realizações e ausentes das competências (D-10). */
export function SkillSuggestions({ profile, onAdd }: Props) {
  const suggestions = suggestSkills(profile);
  if (suggestions.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-semibold text-jf-ink-2">Sugestões a partir das suas realizações</p>
      <ul className="flex flex-wrap gap-2" aria-label="Competências sugeridas">
        {suggestions.map((s) => (
          <li key={s.stackId}>
            <button
              type="button"
              className={`${BTN_OUTLINE} min-h-11 rounded-full border-dashed`}
              onClick={() => onAdd({ name: s.label, years: null, stackId: s.stackId })}
            >
              + {s.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
