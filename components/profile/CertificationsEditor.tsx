"use client";

import type { Profile } from "@/lib/shared/schemas/profile";
import { BTN_OUTLINE, CARD, FIELD, FIELD_LABEL } from "@/components/ui/styles";

type Certification = Profile["certifications"][number];

type Props = { certifications: Certification[]; onChange: (certifications: Certification[]) => void };

const orNull = (v: string): string | null => (v.trim() === "" ? null : v);

export function CertificationsEditor({ certifications, onChange }: Props) {
  const set = (i: number, patch: Partial<Certification>) =>
    onChange(certifications.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold">Certificações</h3>
        <button
          type="button"
          className={BTN_OUTLINE}
          onClick={() => onChange([...certifications, { name: "", issuer: null, year: null }])}
        >
          Adicionar certificação
        </button>
      </div>
      <ul className="flex flex-col gap-3">
        {certifications.map((c, i) => (
          // Valores controlados pelas props: a chave por posição não deixa estado local para a linha seguinte herdar.
          <li key={i} className={`${CARD} flex flex-col gap-3 rounded-xl p-4`}>
            <div className="grid gap-3 sm:grid-cols-[2fr_2fr_1fr]">
              <label className={FIELD_LABEL}>
                Certificação
                <input
                  aria-label={`Nome da certificação ${i + 1}`}
                  className={FIELD}
                  value={c.name}
                  onChange={(e) => set(i, { name: e.target.value })}
                />
              </label>
              <label className={FIELD_LABEL}>
                Emissor
                <input
                  aria-label={`Emissor da certificação ${i + 1}`}
                  className={FIELD}
                  value={c.issuer ?? ""}
                  onChange={(e) => set(i, { issuer: orNull(e.target.value) })}
                />
              </label>
              <label className={FIELD_LABEL}>
                Ano (AAAA)
                <input
                  aria-label={`Ano da certificação ${i + 1}`}
                  className={FIELD}
                  inputMode="numeric"
                  value={c.year ?? ""}
                  onChange={(e) => set(i, { year: orNull(e.target.value) })}
                />
              </label>
            </div>
            <button
              type="button"
              className="min-h-11 w-fit rounded-lg px-3 text-sm font-medium text-jf-danger-fg outline-none hover:bg-jf-danger-bg focus-visible:ring-2 focus-visible:ring-jf-brand"
              onClick={() => onChange(certifications.filter((_, j) => j !== i))}
            >
              Remover certificação<span className="sr-only"> {c.name || i + 1}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
