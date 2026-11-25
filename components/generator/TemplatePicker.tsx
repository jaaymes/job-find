"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BTN_OUTLINE, BTN_PRIMARY } from "@/components/ui/styles";
import { CV_TEMPLATES, getTemplate } from "@/lib/client/pdf/templates/registry";
import type { CvTemplateId } from "@/lib/client/pdf/templates/types";

export type TemplatePickerProps = {
  value: CvTemplateId;
  recommended: CvTemplateId;
  onChange: (id: CvTemplateId, makeDefault: boolean) => void;
  /** Mostra a caixa "Usar como padrão nos próximos CVs". */
  showDefaultOption?: boolean;
  /** Desabilita o botão (ex.: durante a geração, para a escolha não se perder). */
  disabled?: boolean;
};

/** Escolha do modelo do CV: botão com o modelo atual que abre um diálogo com os 10 modelos (todos de coluna única, legíveis por ATS). */
export function TemplatePicker({ value, recommended, onChange, showDefaultOption = true, disabled = false }: TemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const [makeDefault, setMakeDefault] = useState(false);
  const current = getTemplate(value);
  const [selected, setSelected] = useState<CvTemplateId>(value);
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
      <DialogTrigger render={<button type="button" className={BTN_OUTLINE} disabled={disabled} />}>
        {`Modelo do CV: ${current.name}`}
      </DialogTrigger>
      <DialogContent mobile="sheet" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modelo do CV</DialogTitle>
          <DialogDescription>
            Todos os modelos usam coluna única e texto simples, para os sistemas de triagem lerem direito. Trocar de modelo
            não gera o texto de novo.
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Modelos de CV" className="flex flex-col gap-2 sm:max-h-[60vh] sm:overflow-y-auto">
          {CV_TEMPLATES.map((t) => (
            <label
              key={t.id}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-jf-line p-3 text-sm has-checked:border-jf-brand has-checked:bg-jf-chip has-focus-visible:ring-2 has-focus-visible:ring-jf-brand"
            >
              <input
                type="radio"
                name="cv-template"
                className="mt-0.5 size-5 flex-none accent-[var(--color-jf-brand)]"
                checked={t.id === selected}
                onChange={() => setSelected(t.id)}
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-semibold">
                  {t.name}
                  {t.id === recommended && (
                    <span className="ml-2 rounded-full bg-jf-chip px-2 py-0.5 text-xs font-medium text-jf-brand-dark">
                      Recomendado para você
                    </span>
                  )}
                </span>
                <span className="text-jf-ink-2">{t.description}</span>
                <span className="text-xs text-jf-ink-3">Indicado para: {t.bestFor}</span>
              </span>
            </label>
          ))}
        </div>
        {showDefaultOption && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
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
      </DialogContent>
    </Dialog>
  );
}
