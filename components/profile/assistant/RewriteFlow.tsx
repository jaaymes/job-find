"use client";

import { useEffect, useState } from "react";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD, FIELD_LABEL } from "@/components/ui/styles";
import type { AssistLang, AssistTarget, AssistTone, Draft } from "@/lib/client/ai/prompts/profile.assist.v1";
import type { AiSettings } from "@/lib/client/ai/settings";
import { rewriteDraft } from "@/lib/client/profile/assist";
import type { Profile } from "@/lib/shared/schemas/profile";
import { DraftEditor, DraftView, finalDraft, isDraftEmpty, normalizeDraft } from "./DraftEditor";
import { focusOnMount, type useAssistRun } from "./useAssistRun";

type Run = ReturnType<typeof useAssistRun>;
type ToneKey = "default" | "direct" | "technical" | "translate";
type Props = { profile: Profile; target: AssistTarget; settings: AiSettings; current: Draft; gen: Run; onInsert: (d: Draft) => void };

const TONES: { key: ToneKey; label: string }[] = [
  { key: "default", label: "Padrão" },
  { key: "direct", label: "Mais direto" },
  { key: "technical", label: "Mais técnico" },
  { key: "translate", label: "Traduzir" },
];
const LANGS: { key: AssistLang; label: string }[] = [
  { key: "pt", label: "Português" },
  { key: "en", label: "Inglês" },
  { key: "es", label: "Espanhol" },
];

/** RF-22: texto atual e sugestão lado a lado (empilhados no celular), com tom e idioma. */
export function RewriteFlow({ profile, target, settings, current, gen, onInsert }: Props) {
  const { run, busy, error, cancel } = gen;
  const [tone, setTone] = useState<ToneKey>("default");
  const [lang, setLang] = useState<AssistLang>("en");
  const [suggestion, setSuggestion] = useState<Draft | null>(null);

  const generate = async (t: ToneKey = tone, l: AssistLang = lang) => {
    const toneArg: AssistTone = t === "translate" ? { tone: "translate", lang: l } : { tone: t };
    const out = await run(({ signal, onPartial }) =>
      rewriteDraft({ profile, target, settings, current, tone: toneArg, signal, onPartial }),
    );
    if (out) setSuggestion(normalizeDraft(target, out));
  };

  useEffect(() => {
    // Adiado um tick (e cancelado no cleanup) para a geração não rodar no corpo do efeito (set-state-in-effect)
    // nem disparar duas vezes no StrictMode.
    const t = setTimeout(() => void generate(), 0);
    return () => clearTimeout(t);
    // Só na abertura do painel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className={`${FIELD_LABEL} sm:w-48`}>
          Tom
          <select className={FIELD} value={tone} disabled={busy} onChange={(e) => setTone(e.target.value as ToneKey)}>
            {TONES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {tone === "translate" && (
          <label className={`${FIELD_LABEL} sm:w-48`}>
            Idioma
            <select className={FIELD} value={lang} disabled={busy} onChange={(e) => setLang(e.target.value as AssistLang)}>
              {LANGS.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex sm:items-end">
          <button
            type="button"
            className={`${BTN_OUTLINE} min-h-11 w-full px-4 text-sm sm:w-auto`}
            disabled={busy}
            onClick={() => void generate()}
          >
            Gerar de novo
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section aria-labelledby="assist-current" className="flex flex-col gap-2">
          <h3 id="assist-current" className="text-[13px] font-semibold text-jf-ink-2">
            Texto atual
          </h3>
          <div className="rounded-lg border border-jf-line bg-jf-surface p-3">
            <DraftView target={target} value={current} />
          </div>
        </section>
        <section aria-labelledby="assist-suggestion" className="flex flex-col gap-2">
          <h3 id="assist-suggestion" className="text-[13px] font-semibold text-jf-ink-2">
            Sugestão
          </h3>
          {busy ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-jf-ink-3">Escrevendo a sugestão...</p>
              <button type="button" ref={focusOnMount} className={`${BTN_OUTLINE} min-h-11 px-4 text-sm`} onClick={cancel}>
                Cancelar
              </button>
            </div>
          ) : suggestion ? (
            <DraftEditor target={target} value={suggestion} onChange={setSuggestion} label="Sugestão editável" autoFocus />
          ) : (
            <p className="text-sm text-jf-ink-3">Nenhuma sugestão ainda. Use “Gerar de novo”.</p>
          )}
        </section>
      </div>

      {error && (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg bg-jf-danger-bg px-3 py-2 text-sm text-jf-danger-fg">
          <p>{error}</p>
          <button type="button" className={`${BTN_OUTLINE} min-h-11 px-4 text-sm`} onClick={() => void generate()}>
            Tentar de novo
          </button>
        </div>
      )}

      <div className="flex sm:justify-end">
        <button
          type="button"
          className={`${BTN_PRIMARY} min-h-11 w-full px-4 text-sm sm:w-auto`}
          disabled={busy || !suggestion || isDraftEmpty(target, suggestion)}
          onClick={() => suggestion && onInsert(finalDraft(target, suggestion))}
        >
          Inserir no perfil
        </button>
      </div>
    </div>
  );
}
