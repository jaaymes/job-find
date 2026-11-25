"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { BTN_OUTLINE, BTN_PRIMARY } from "@/components/ui/styles";
import { assembleBaseCv, type AssembledCv } from "@/lib/client/cv/assemble";
import { CV_TEMPLATES, getTemplate } from "@/lib/client/pdf/templates/registry";
import { sampleProfile } from "@/lib/client/pdf/templates/sample";
import type { CvTemplate, CvTemplateId } from "@/lib/client/pdf/templates/types";
import { useMediaQuery } from "@/lib/client/use-media-query";
import { PdfPreview } from "./PdfPreview";
import { TemplateThumb } from "./TemplateThumb";

export type TemplatePickerProps = {
  value: CvTemplateId;
  recommended: CvTemplateId;
  onChange: (id: CvTemplateId, makeDefault: boolean) => void;
  /** Mostra a caixa "Usar como padrão nos próximos CVs". */
  showDefaultOption?: boolean;
  /** Desabilita o botão (ex.: durante a geração, para a escolha não se perder). */
  disabled?: boolean;
  /** CV usado na prévia em PDF; sem ele, a prévia usa um perfil fictício. */
  previewCv?: AssembledCv;
};

function Details({ t, recommended }: { t: CvTemplate; recommended: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold">
        {t.name}
        {recommended && (
          <span className="rounded-full bg-jf-brand-soft px-2 py-0.5 text-xs font-medium text-jf-brand-dark">
            Recomendado para você
          </span>
        )}
      </p>
      <p className="text-sm text-jf-ink-2">{t.description}</p>
      <p className="text-[13px] text-jf-ink-3">Indicado para: {t.bestFor}</p>
    </div>
  );
}

/**
 * Escolha do modelo do CV: botão com o modelo atual que abre uma galeria com os 10 modelos (todos de coluna única,
 * legíveis por ATS). Cada modelo tem uma miniatura; em telas largas, o modelo marcado aparece ao lado como PDF de
 * verdade, montado com o CV do usuário (ou com um perfil fictício).
 */
export function TemplatePicker({
  value,
  recommended,
  onChange,
  showDefaultOption = true,
  disabled = false,
  previewCv,
}: TemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const [makeDefault, setMakeDefault] = useState(false);
  const current = getTemplate(value);
  const [selected, setSelected] = useState<CvTemplateId>(value);
  const wide = useMediaQuery("(min-width: 768px)");
  const sampleCv = useMemo(() => (previewCv ? null : assembleBaseCv(sampleProfile(), "pt")), [previewCv]);
  const cv = previewCv ?? sampleCv!;
  const chosen = getTemplate(selected);

  // A seleção é local: setas do teclado só movem a marcação entre os modelos; quem confirma é o botão.
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
      <DialogContent
        mobile="sheet"
        className="gap-4 sm:flex sm:max-h-[min(92vh,900px)] sm:max-w-[min(1100px,calc(100%-2rem))] sm:flex-col sm:overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle>Modelo do CV</DialogTitle>
          <DialogDescription>
            Todos os modelos usam coluna única e texto simples, para os sistemas de triagem lerem direito. Trocar de modelo
            não gera o texto de novo.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1 md:mx-0 md:grid md:overflow-visible md:px-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div
            role="radiogroup"
            aria-label="Modelos de CV"
            className="grid grid-cols-2 content-start gap-3 sm:grid-cols-3 md:-m-1 md:overflow-y-auto md:p-1 md:pr-2"
          >
            {CV_TEMPLATES.map((t) => (
              <label
                key={t.id}
                className="group flex cursor-pointer flex-col gap-2 rounded-xl border border-jf-line bg-jf-surface-2 p-2.5 transition-colors hover:border-jf-line-strong has-checked:border-jf-brand has-checked:bg-jf-brand-soft has-focus-visible:ring-2 has-focus-visible:ring-jf-brand"
              >
                <input
                  type="radio"
                  name="cv-template"
                  className="sr-only"
                  checked={t.id === selected}
                  onChange={() => setSelected(t.id)}
                />
                <TemplateThumb template={t} className="px-1.5 pt-1.5" />
                <span className="flex min-h-9 flex-col justify-center text-[13px] leading-tight font-semibold group-has-checked:text-jf-brand-dark">
                  {t.name}
                  {t.id === recommended && <span className="text-xs font-medium text-jf-brand">Recomendado</span>}
                </span>
                <span className="sr-only">{`${t.description} Indicado para: ${t.bestFor}`}</span>
              </label>
            ))}
          </div>

          <div className="flex min-h-0 flex-col gap-3 rounded-xl border border-jf-line bg-jf-surface-2 p-3 sm:p-4">
            <Details t={chosen} recommended={chosen.id === recommended} />
            {wide && open && (
              <div className="min-h-0 flex-1 overflow-y-auto rounded-lg">
                <PdfPreview cv={cv} templateId={selected} letter={null} mode="canvas" />
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-jf-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          {showDefaultOption ? (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-5 accent-[var(--color-jf-brand)]"
                checked={makeDefault}
                onChange={(e) => setMakeDefault(e.target.checked)}
              />
              Usar como padrão nos próximos CVs
            </label>
          ) : (
            <span className="text-[13px] text-jf-ink-3 max-sm:hidden">
              {previewCv ? "A prévia usa os dados do seu perfil." : "A prévia usa um perfil de exemplo."}
            </span>
          )}
          <button type="button" className={`${BTN_PRIMARY} sm:min-w-52`} onClick={confirm}>
            Usar este modelo
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
