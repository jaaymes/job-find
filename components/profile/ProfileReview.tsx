"use client";

import { useId, useState } from "react";
import { reviewProfile, type Finding } from "@/lib/client/profile/review";
import type { Profile } from "@/lib/shared/schemas/profile";
import { BTN_OUTLINE, CARD } from "@/components/ui/styles";

type Props = {
  profile: Profile;
  /** Abre o assistente (reescrita) no item do achado. */
  onFix: (f: Finding) => void;
};

/** Achados de `skill_missing` são resolvidos pelos chips de competências, sem "Corrigir". */
const fixable = (f: Finding) => f.kind !== "skill_missing";

/** Botão "Revisar perfil" e a lista de achados determinísticos (D-09). */
export function ProfileReview({ profile, onFix }: Props) {
  const [open, setOpen] = useState(false);
  const base = useId();
  const findings = open ? reviewProfile(profile) : [];

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        className={`${BTN_OUTLINE} min-h-11 w-fit`}
        onClick={() => setOpen((v) => !v)}
      >
        Revisar perfil
      </button>
      {open &&
        (findings.length === 0 ? (
          <p role="status" className="text-sm text-jf-ink-2">
            Nenhum ponto de atenção encontrado.
          </p>
        ) : (
          <ul aria-label="Achados da revisão" className={`${CARD} flex flex-col divide-y divide-jf-line`}>
            {findings.map((f, i) => (
              <li key={`${f.kind}-${i}`} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <p id={`${base}-${i}`} className="min-w-0 flex-1 text-sm text-jf-ink-2">
                  {f.message}
                </p>
                {fixable(f) && (
                  <button
                    type="button"
                    aria-describedby={`${base}-${i}`}
                    className={`${BTN_OUTLINE} min-h-11`}
                    onClick={() => onFix(f)}
                  >
                    Corrigir
                  </button>
                )}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
