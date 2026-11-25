"use client";

import { BTN_OUTLINE, BTN_PRIMARY, CARD, FIELD, FIELD_LABEL } from "@/components/ui/styles";
import type { CvLang } from "@/lib/client/cv/period";

export type ToolbarProps = {
  lang: CvLang;
  includeLetter: boolean;
  hasDocs: boolean;
  running: boolean;
  /** Há perfil e provedor: sem isso não dá para gerar. */
  canGenerate: boolean;
  /** A carta existe (e foi pedida). */
  letterAvailable: boolean;
  /** A carta tem trecho em revisão: o download fica bloqueado. */
  letterBlocked: boolean;
  downloading: boolean;
  onLang: (l: CvLang) => void;
  onLetter: (checked: boolean) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onDownloadCv: () => void;
  onDownloadLetter: () => void;
};

const LANGS: { id: CvLang; label: string }[] = [
  { id: "pt", label: "Português" },
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
];

/** Só há um modelo de CV (coluna única, legível por ATS), então não há seletor de modelo. */
export function GeneratorToolbar(p: ToolbarProps) {
  return (
    <section aria-label="Opções de geração" className={`${CARD} flex flex-wrap items-end gap-x-5 gap-y-3 p-4 sm:p-5`}>
      <label className={`${FIELD_LABEL} w-44`}>
        Idioma do CV
        <select
          className={FIELD}
          value={p.lang}
          disabled={p.running}
          onChange={(e) => p.onLang(e.target.value as CvLang)}
        >
          {LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="size-5 accent-[var(--color-jf-brand)]"
          checked={p.includeLetter}
          disabled={p.running}
          onChange={(e) => p.onLetter(e.target.checked)}
        />
        Incluir carta de apresentação
      </label>
      <div className="flex flex-wrap gap-2 empty:hidden sm:ml-auto">
        {p.canGenerate && (
          <button type="button" className={p.hasDocs ? `${BTN_OUTLINE} max-lg:hidden` : BTN_PRIMARY} onClick={p.onGenerate} disabled={p.running}>
            {p.running ? "Gerando…" : p.hasDocs ? "Regenerar" : "Gerar CV para esta vaga"}
          </button>
        )}
        {p.running && (
          <button type="button" className={BTN_OUTLINE} onClick={p.onCancel}>
            Cancelar
          </button>
        )}
        {p.hasDocs && !p.running && (
          <>
            <button type="button" className={`${BTN_PRIMARY} max-lg:hidden`} onClick={p.onDownloadCv} disabled={p.downloading}>
              Baixar PDF
            </button>
            {p.letterAvailable && (
              <button
                type="button"
                className={`${BTN_OUTLINE} max-lg:hidden`}
                onClick={p.onDownloadLetter}
                disabled={p.downloading || p.letterBlocked}
                title={p.letterBlocked ? "Aprove ou corrija o trecho em revisão da carta para baixar." : undefined}
              >
                Baixar carta (PDF)
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
