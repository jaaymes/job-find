"use client";

import { useEffect, useState } from "react";
import { BTN_OUTLINE, BTN_PRIMARY, FIELD, FIELD_LABEL } from "@/components/ui/styles";
import type { AssistTarget, Draft } from "@/lib/client/ai/prompts/profile.assist.v1";
import type { AiSettings } from "@/lib/client/ai/settings";
import { askQuestions, writeDrafts } from "@/lib/client/profile/assist";
import type { Profile } from "@/lib/shared/schemas/profile";
import { DraftEditor, finalDraft, isDraftEmpty, normalizeDraft } from "./DraftEditor";
import { focusOnMount, type useAssistRun } from "./useAssistRun";

type Run = ReturnType<typeof useAssistRun>;
type Props = { profile: Profile; target: AssistTarget; settings: AiSettings; gen: Run; onInsert: (d: Draft) => void };

/** RF-21: perguntas → respostas opcionais → 2 opções editáveis. As respostas vivem só neste estado. */
export function InterviewFlow({ profile, target, settings, gen, onInsert }: Props) {
  const { run, busy, error, cancel } = gen;
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [options, setOptions] = useState<[Draft, Draft] | null>(null);
  const [chosen, setChosen] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const [lastAction, setLastAction] = useState<"questions" | "write">("questions");

  const loadQuestions = async () => {
    setCancelled(false);
    const qs = await run(({ signal, onPartial }) => askQuestions({ profile, target, settings, signal, onPartial }));
    if (qs) {
      setQuestions(qs);
      setAnswers(qs.map(() => ""));
    } else {
      setCancelled(true); // cancelado (ou erro, que o bloco de erro mostra no lugar)
    }
  };

  useEffect(() => {
    // Adiado um tick (e cancelado no cleanup) para a geração não rodar no corpo do efeito (set-state-in-effect)
    // nem disparar duas vezes no StrictMode.
    const t = setTimeout(() => void loadQuestions(), 0);
    return () => clearTimeout(t);
    // Só na abertura do painel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = async () => {
    if (!questions) return;
    setLastAction("write");
    const qa = questions.map((question, i) => ({ question, answer: answers[i] ?? "" }));
    const out = await run(({ signal, onPartial }) => writeDrafts({ profile, target, settings, qa, signal, onPartial }));
    if (out) {
      setOptions([normalizeDraft(target, out[0]), normalizeDraft(target, out[1])]);
      setChosen(0);
    }
  };

  const retry = () => {
    if (lastAction === "write") return generate();
    setLastAction("questions");
    return loadQuestions();
  };

  const errorBlock = error && (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-lg bg-jf-danger-bg px-3 py-2 text-sm text-jf-danger-fg">
      <p>{error}</p>
      <button type="button" className={`${BTN_OUTLINE} min-h-11 px-4 text-sm`} onClick={() => void retry()}>
        Tentar de novo
      </button>
    </div>
  );

  if (busy) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-jf-ink-3">{lastAction === "write" ? "Escrevendo as opções..." : "Preparando as perguntas..."}</p>
        <button type="button" ref={focusOnMount} className={`${BTN_OUTLINE} min-h-11 px-4 text-sm`} onClick={cancel}>
          Cancelar
        </button>
      </div>
    );
  }

  if (options) {
    const current = options[chosen];
    const setCurrent = (d: Draft) => setOptions((o) => (o ? (chosen === 0 ? [d, o[1]] : [o[0], d]) : o));
    return (
      <div className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="Opções sugeridas" className="flex gap-2">
          {options.map((_, i) => (
            <label
              key={i}
              className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-lg border border-jf-line px-3 text-sm font-semibold text-jf-ink has-[:checked]:border-jf-brand has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-jf-brand"
            >
              <input
                type="radio"
                name="assist-option"
                ref={i === chosen ? focusOnMount : undefined}
                checked={chosen === i}
                onChange={() => setChosen(i)}
              />
              Opção {i + 1}
            </label>
          ))}
        </div>
        <DraftEditor key={chosen} target={target} value={current} onChange={setCurrent} label={`Texto da opção ${chosen + 1}`} />
        {errorBlock}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={`${BTN_OUTLINE} min-h-11 px-4 text-sm`} onClick={() => setOptions(null)}>
            Voltar às respostas
          </button>
          <button
            type="button"
            className={`${BTN_PRIMARY} min-h-11 px-4 text-sm`}
            disabled={isDraftEmpty(target, current)}
            onClick={() => onInsert(finalDraft(target, current))}
          >
            Inserir no perfil
          </button>
        </div>
      </div>
    );
  }

  if (!questions) {
    return (
      errorBlock || (
        <div className="flex flex-col items-start gap-2">
          {cancelled && <p className="text-sm text-jf-ink-3">Geração cancelada.</p>}
          <button type="button" ref={cancelled ? focusOnMount : undefined} className={`${BTN_OUTLINE} min-h-11 px-4 text-sm`} onClick={() => void loadQuestions()}>
            Tentar de novo
          </button>
        </div>
      )
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void generate();
      }}
    >
      <p className="text-sm text-jf-ink-3">Responda o que quiser (todas as perguntas são opcionais). Quanto mais detalhe, melhor o texto.</p>
      {questions.map((q, i) => (
        <label key={i} className={FIELD_LABEL}>
          {q}
          <textarea
            ref={i === 0 ? focusOnMount : undefined}
            rows={3}
            className={FIELD}
            value={answers[i] ?? ""}
            onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))}
          />
        </label>
      ))}
      {errorBlock}
      <div className="flex sm:justify-end">
        <button type="submit" className={`${BTN_PRIMARY} min-h-11 w-full px-4 text-sm sm:w-auto`}>
          Gerar
        </button>
      </div>
    </form>
  );
}
