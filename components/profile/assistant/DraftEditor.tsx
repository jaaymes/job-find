"use client";

import { FIELD, FIELD_LABEL, BTN_OUTLINE } from "@/components/ui/styles";
import type { AssistTarget, Draft } from "@/lib/client/ai/prompts/profile.assist.v1";
import { focusOnMount } from "./useAssistRun";

/** Só o campo do alvo vale: `bullets` para a lista de uma experiência, `text` para título e resumo. */
export function normalizeDraft(target: AssistTarget, d: Draft): Draft {
  return target.kind === "bullets" ? { text: null, bullets: d.bullets ?? [] } : { text: d.text ?? "", bullets: null };
}

/** Rascunho pronto para inserir: sem espaços nas pontas e sem bullets vazios. */
export function finalDraft(target: AssistTarget, d: Draft): Draft {
  return target.kind === "bullets"
    ? { text: null, bullets: (d.bullets ?? []).map((b) => b.trim()).filter(Boolean) }
    : { text: (d.text ?? "").trim(), bullets: null };
}

export function isDraftEmpty(target: AssistTarget, d: Draft): boolean {
  const f = finalDraft(target, d);
  return target.kind === "bullets" ? f.bullets!.length === 0 : !f.text;
}

const FIELD_NAME = { headline: "Título", summary: "Resumo", bullets: "Realizações" } as const;
export const targetName = (t: AssistTarget) => FIELD_NAME[t.kind];

/** Texto atual (somente leitura) do alvo. */
export function DraftView({ target, value }: { target: AssistTarget; value: Draft }) {
  if (target.kind === "bullets") {
    return (
      <ul className="list-disc space-y-1 pl-5 text-sm text-jf-ink">
        {(value.bullets ?? []).map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    );
  }
  return <p className="whitespace-pre-wrap text-sm text-jf-ink">{value.text}</p>;
}

type Props = { target: AssistTarget; value: Draft; onChange: (d: Draft) => void; label?: string; autoFocus?: boolean };

/** Prévia editável: uma `textarea` para título/resumo, ou uma por bullet (com "Remover"). */
export function DraftEditor({ target, value, onChange, label, autoFocus }: Props) {
  if (target.kind === "bullets") {
    const bullets = value.bullets ?? [];
    return (
      <ul className="flex flex-col gap-2" aria-label={label ?? "Realizações sugeridas"}>
        {bullets.map((b, i) => (
          <li key={i} className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <textarea
              ref={autoFocus && i === 0 ? focusOnMount : undefined}
              aria-label={`Realização ${i + 1}`}
              rows={3}
              className={FIELD}
              value={b}
              onChange={(e) => onChange({ text: null, bullets: bullets.map((x, j) => (j === i ? e.target.value : x)) })}
            />
            <button
              type="button"
              aria-label={`Remover realização ${i + 1}`}
              className={`${BTN_OUTLINE} min-h-11 px-3 text-sm`}
              onClick={() => onChange({ text: null, bullets: bullets.filter((_, j) => j !== i) })}
            >
              Remover
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <label className={FIELD_LABEL}>
      <span className="sr-only">{label ?? "Texto sugerido"}</span>
      <textarea
        ref={autoFocus ? focusOnMount : undefined}
        rows={6}
        className={FIELD}
        value={value.text ?? ""}
        onChange={(e) => onChange({ text: e.target.value, bullets: null })}
      />
    </label>
  );
}
