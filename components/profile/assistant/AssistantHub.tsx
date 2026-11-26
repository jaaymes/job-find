"use client";

import { Sparkles } from "lucide-react";
import { BTN_PRIMARY } from "@/components/ui/styles";

type Props = {
  headlineEmpty: boolean;
  summaryEmpty: boolean;
  /** Primeira experiência do perfil; `null` quando não há nenhuma. */
  firstExpId: string | null;
  onField: (field: "headline" | "summary") => void;
  onExperience: (expId: string) => void;
};

const SHORTCUT = `${BTN_PRIMARY} min-h-11 gap-2 px-4 text-sm`;

/** Atalhos em destaque para o assistente de IA: título, resumo e experiências. */
export function AssistantHub({ headlineEmpty, summaryEmpty, firstExpId, onField, onExperience }: Props) {
  return (
    <section aria-labelledby="assistant-hub-title" className="flex flex-col gap-3 rounded-xl border border-jf-brand bg-jf-brand-soft p-4">
      <div className="flex flex-col gap-1">
        <h3 id="assistant-hub-title" className="flex items-center gap-2 text-[15px] font-semibold">
          <Sparkles aria-hidden className="size-4 text-jf-brand" />
          Assistente de IA
        </h3>
        <p className="text-sm text-jf-ink-2">A IA pode escrever ou melhorar seus textos a partir do que você já tem.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={SHORTCUT} onClick={() => onField("headline")}>
          <Sparkles aria-hidden />
          {headlineEmpty ? "Escrever o título com IA" : "Melhorar o título com IA"}
        </button>
        <button type="button" className={SHORTCUT} onClick={() => onField("summary")}>
          <Sparkles aria-hidden />
          {summaryEmpty ? "Escrever o resumo com IA" : "Melhorar o resumo com IA"}
        </button>
        <button type="button" className={SHORTCUT} disabled={firstExpId === null} onClick={() => firstExpId && onExperience(firstExpId)}>
          <Sparkles aria-hidden />
          Melhorar experiências com IA
        </button>
      </div>
      {firstExpId === null && <p className="text-sm text-jf-ink-3">Adicione uma experiência para usar o assistente nela.</p>}
    </section>
  );
}
