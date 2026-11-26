"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BTN_OUTLINE, BTN_PRIMARY } from "@/components/ui/styles";
import type { AssembledCv } from "@/lib/client/cv/assemble";
import { CV_TEMPLATES, getTemplate } from "@/lib/client/pdf/templates/registry";
import type { CvTemplateId } from "@/lib/client/pdf/templates/types";
import { CvThumbnail } from "./CvThumbnail";
import { PdfPreview } from "./PdfPreview";

export type TemplatePickerProps = {
  value: CvTemplateId;
  recommended: CvTemplateId;
  onChange: (id: CvTemplateId, makeDefault: boolean) => void;
  /** CV usado nas miniaturas e na prévia grande (perfil salvo ou CV gerado). */
  cv: AssembledCv;
  /** Mostra a caixa "Usar como padrão nos próximos CVs". */
  showDefaultOption?: boolean;
  /** Desabilita o botão (ex.: durante a geração, para a escolha não se perder). */
  disabled?: boolean;
};

/**
 * Escolha do modelo do CV: botão com a miniatura do modelo atual que abre uma galeria com os 10 modelos (todos de
 * coluna única, legíveis por ATS) em folhas A4 pequenas e a prévia grande do selecionado.
 */
export function TemplatePicker({ value, recommended, onChange, cv, showDefaultOption = true, disabled = false }: TemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const [makeDefault, setMakeDefault] = useState(false);
  const current = getTemplate(value);
  const [selected, setSelected] = useState<CvTemplateId>(value);
  const chosen = getTemplate(selected);
  // A seleção é local: setas do teclado só movem o foco entre os modelos; quem confirma é o botão.
  const onOpenChange = (next: boolean) => {
    if (next) {
      setSelected(value);
      setMakeDefault(false);
    }
    setOpen(next);
  };
  const confirm = () => {
    onChange(selected, showDefaultOption && makeDefault);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={<button type="button" className={`${BTN_OUTLINE} justify-start gap-3 py-1.5 pl-1.5`} disabled={disabled} />}
        aria-label={`Modelo do CV: ${current.name}`}
      >
        <CvThumbnail cv={cv} templateId={value} width={56} className="w-14 flex-none" />
        <span className="text-left">
          Modelo: <span className="font-semibold">{current.name}</span>
          <span className="text-jf-ink-3"> · Trocar</span>
        </span>
      </DialogTrigger>
      <DialogContent mobile="sheet" className="gap-3 sm:flex sm:h-[88vh] sm:max-w-6xl sm:flex-col sm:overflow-hidden">
        <DialogHeader className="pr-10">
          <DialogTitle>Modelo do CV</DialogTitle>
          <DialogDescription>
            Todos os modelos usam coluna única e texto simples, para os sistemas de triagem lerem direito. Trocar de modelo
            não gera o texto de novo.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:min-h-0 sm:flex-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div
            role="radiogroup"
            aria-label="Modelos de CV"
            className="grid grid-cols-2 content-start gap-3 lg:grid-cols-3 sm:min-h-0 sm:overflow-y-auto sm:p-1"
          >
            {CV_TEMPLATES.map((t) => (
              <div key={t.id} className="flex min-w-0 flex-col">
                <label
                  className="flex h-full cursor-pointer flex-col gap-2 rounded-xl border border-jf-line p-2 text-sm hover:bg-jf-chip has-checked:border-jf-brand has-checked:bg-jf-chip has-focus-visible:ring-2 has-focus-visible:ring-jf-brand"
                >
                  <CvThumbnail cv={cv} templateId={t.id} width={150} className="mx-auto w-full max-w-[150px]" />
                  <span className="flex min-h-6 items-center gap-2 font-semibold">
                    <input
                      type="radio"
                      name="cv-template"
                      aria-describedby={`cv-template-desc-${t.id}`}
                      className="size-4 flex-none accent-[var(--color-jf-brand)]"
                      checked={t.id === selected}
                      onChange={() => setSelected(t.id)}
                    />
                    <span className="min-w-0">{t.name}</span>
                  </span>
                  {t.id === recommended && (
                    <span className="self-start rounded-full bg-jf-surface px-2 py-0.5 text-xs font-medium text-jf-brand-dark ring-1 ring-jf-line">
                      Recomendado para você
                    </span>
                  )}
                </label>
                <span id={`cv-template-desc-${t.id}`} className="sr-only">
                  <span>{t.description}</span> <span>Indicado para: {t.bestFor}</span>
                </span>
              </div>
            ))}
          </div>
          <section aria-label="Prévia do modelo" className="flex flex-col gap-2 sm:min-h-0 sm:overflow-y-auto sm:pr-1">
            <h3 className="text-base font-semibold">{chosen.name}</h3>
            <p className="text-jf-ink-2">{chosen.description}</p>
            <p className="text-xs text-jf-ink-3">Indicado para: {chosen.bestFor}</p>
            <PdfPreview cv={cv} templateId={selected} letter={null} mode="canvas" />
          </section>
        </div>
        <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col gap-3 border-t border-jf-line bg-popover px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:static sm:flex-row sm:items-center sm:justify-end sm:pb-4">
          {showDefaultOption && (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium sm:mr-auto">
              <input
                type="checkbox"
                className="size-5 accent-[var(--color-jf-brand)]"
                checked={makeDefault}
                onChange={(e) => setMakeDefault(e.target.checked)}
              />
              Usar como padrão nos próximos CVs
            </label>
          )}
          <button type="button" className={BTN_PRIMARY} onClick={confirm}>
            Usar este modelo
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
