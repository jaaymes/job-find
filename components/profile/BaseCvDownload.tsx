"use client";

import { useMemo, useState } from "react";
import { TemplatePicker } from "@/components/generator/TemplatePicker";
import { BTN_PRIMARY, CARD, FIELD, FIELD_LABEL } from "@/components/ui/styles";
import { assembleBaseCv } from "@/lib/client/cv/assemble";
import type { CvLang } from "@/lib/client/cv/period";
import { cvFileName } from "@/lib/client/pdf/filename";
import { cvPrefsStore, resolveTemplateId } from "@/lib/client/pdf/templates/prefs";
import { recommendTemplate } from "@/lib/client/pdf/templates/recommend";
import type { CvTemplateId } from "@/lib/client/pdf/templates/types";
import { useStore } from "@/lib/client/storage/store";
import type { Profile } from "@/lib/shared/schemas/profile";

const LANGS: { id: CvLang; label: string }[] = [
  { id: "pt", label: "Português" },
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
];

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Seção "Modelos de CV" do perfil: o modelo escolhido aqui vira o padrão dos próximos CVs (`cvPrefs`) e é o
 * usado no CV base (RF-37), montado só com o perfil salvo, sem vaga e sem IA.
 */
export function BaseCvDownload({ profile }: { profile: Profile }) {
  const prefs = useStore(cvPrefsStore);
  const [lang, setLang] = useState<CvLang>("pt");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const cv = useMemo(() => assembleBaseCv(profile, lang), [profile, lang]);
  const templateId = resolveTemplateId(null, prefs ?? { templateId: null }, profile, null);
  const choose = (id: CvTemplateId) => cvPrefsStore.set({ templateId: id });

  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      const render = await import("@/lib/client/pdf/render");
      const { blob } = await render.renderCvPdf(cv, templateId);
      saveBlob(blob, cvFileName(profile.name ?? "", "", ""));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="modelos-de-cv" aria-labelledby="base-cv-t" className={`${CARD} mt-6 flex flex-col gap-3 p-4 sm:p-6`}>
      <h2 id="base-cv-t" className="text-lg font-semibold">
        Modelos de CV
      </h2>
      <p className="text-sm text-jf-ink-3">
        O modelo escolhido aqui é o padrão dos próximos CVs gerados para as vagas (dá para trocar em cada CV). O CV
        base é um PDF só com os dados do perfil salvo, sem vaga e sem IA: salve o perfil antes para incluir as
        últimas edições.
      </p>
      <div className="flex flex-col items-stretch gap-3">
        <TemplatePicker
          value={templateId}
          recommended={recommendTemplate(profile, null)}
          onChange={(id) => choose(id)}
          cv={cv}
          showDefaultOption={false}
        />
        <label className={FIELD_LABEL}>
          Idioma dos rótulos do CV
          <select className={`${FIELD}`} value={lang} onChange={(e) => setLang(e.target.value as CvLang)}>
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void download()}>
          {busy ? "Gerando PDF…" : "Baixar CV base"}
        </button>
      </div>
      {failed && (
        <p role="alert" className="text-sm text-jf-danger-fg">
          Não foi possível gerar o PDF. Tente de novo.
        </p>
      )}
    </section>
  );
}
