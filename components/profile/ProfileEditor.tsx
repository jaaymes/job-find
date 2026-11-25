"use client";

import { useState } from "react";
import { useUnsavedChangesGuard } from "@/lib/client/use-unsaved-changes-guard";
import {
  ENGLISH_LABEL,
  ENGLISH_LEVELS,
  SENIORITIES,
  SENIORITY_LABEL,
  type Profile,
} from "@/lib/shared/schemas/profile";
import { ContactLinks } from "./ContactLinks";
import { EducationEditor } from "./EducationEditor";
import { ExperienceEditor } from "./ExperienceEditor";
import { SkillChips } from "./SkillChips";
import { CARD, FIELD, FIELD_LABEL } from "@/components/ui/styles";

type Props = {
  profile: Profile;
  /** Devolve `true` se gravou. */
  onSave: (p: Profile) => boolean;
};

const orNull = (v: string): string | null => (v.trim() === "" ? null : v);

/** Edita uma cópia do perfil; só grava no localStorage ao clicar em "Salvar perfil". */
export function ProfileEditor({ profile, onSave }: Props) {
  const [draft, setDraft] = useState(profile);
  const [saved, setSaved] = useState<"idle" | "ok">("idle");
  const [dirty, setDirty] = useState(false);
  useUnsavedChangesGuard(dirty, "Você tem alterações não salvas no perfil. Sair mesmo assim?");
  const patch = (p: Partial<Profile>) => {
    setDraft((d) => ({ ...d, ...p }));
    setSaved("idle");
    setDirty(true);
  };

  return (
    <section aria-labelledby="ed-t" className={`${CARD} flex min-w-0 flex-col gap-5 p-4 sm:p-6`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="ed-t" className="text-lg font-semibold">
          Dados do perfil
        </h2>
        <button
          type="button"
          className="inline-flex min-h-11 items-center rounded-[10px] bg-jf-ink px-[18px] text-sm font-semibold text-jf-surface outline-none hover:bg-jf-ink-2 focus-visible:ring-2 focus-visible:ring-jf-brand focus-visible:ring-offset-2"
          onClick={() => {
            const ok = onSave(draft);
            setSaved(ok ? "ok" : "idle");
            if (ok) setDirty(false);
          }}
        >
          Salvar perfil
        </button>
      </div>
      {saved === "ok" && (
        <p role="status" className="text-sm text-jf-alta">
          Perfil salvo neste navegador.
        </p>
      )}

      <div className="grid gap-3.5 sm:grid-cols-2">
        <label className={FIELD_LABEL}>
          Nome
          <input className={FIELD} value={draft.name ?? ""} onChange={(e) => patch({ name: orNull(e.target.value) })} />
        </label>
        <label className={`${FIELD_LABEL} sm:col-span-2`}>
          Título profissional
          <input
            className={FIELD}
            value={draft.headline ?? ""}
            onChange={(e) => patch({ headline: orNull(e.target.value) })}
          />
        </label>
        <label className={FIELD_LABEL}>
          Cidade
          <input
            className={FIELD}
            value={draft.location ?? ""}
            onChange={(e) => patch({ location: orNull(e.target.value) })}
          />
        </label>
        <label className={FIELD_LABEL}>
          Senioridade
          <select
            className={FIELD}
            value={draft.seniority ?? ""}
            onChange={(e) => patch({ seniority: (e.target.value || null) as Profile["seniority"] })}
          >
            <option value="">Não informada</option>
            {SENIORITIES.map((s) => (
              <option key={s} value={s}>
                {SENIORITY_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className={FIELD_LABEL}>
          Inglês
          <select
            className={FIELD}
            value={draft.englishLevel ?? ""}
            onChange={(e) => patch({ englishLevel: (e.target.value || null) as Profile["englishLevel"] })}
          >
            <option value="">Não informado</option>
            {ENGLISH_LEVELS.map((s) => (
              <option key={s} value={s}>
                {ENGLISH_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className={FIELD_LABEL}>
          E-mail (fica só neste navegador)
          <input
            type="email"
            className={FIELD}
            value={draft.contact.email ?? ""}
            onChange={(e) => patch({ contact: { ...draft.contact, email: orNull(e.target.value) } })}
          />
        </label>
        <label className={FIELD_LABEL}>
          Telefone (fica só neste navegador)
          <input
            type="tel"
            className={FIELD}
            value={draft.contact.phone ?? ""}
            onChange={(e) => patch({ contact: { ...draft.contact, phone: orNull(e.target.value) } })}
          />
        </label>
      </div>
      <ContactLinks
        links={draft.contact.links}
        onChange={(links) => patch({ contact: { ...draft.contact, links } })}
      />
      <label className={FIELD_LABEL}>
        Resumo
        <textarea
          rows={3}
          className={FIELD}
          value={draft.summary ?? ""}
          onChange={(e) => patch({ summary: orNull(e.target.value) })}
        />
      </label>

      <SkillChips skills={draft.skills} onChange={(skills) => patch({ skills })} />
      <ExperienceEditor experiences={draft.experiences} onChange={(experiences) => patch({ experiences })} />

      <EducationEditor education={draft.education} onChange={(education) => patch({ education })} />
    </section>
  );
}
