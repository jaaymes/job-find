"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AiError, isAbortError } from "@/lib/client/ai/errors";
import { ASSIST_INVENTED_MESSAGE } from "@/lib/client/profile/assist";

export const GENERIC_ERROR = "Não foi possível gerar agora. Tente de novo.";

/** Foco no primeiro campo de cada passo: ref estável, roda só quando o elemento monta. */
export const focusOnMount = (el: HTMLElement | null) => el?.focus();

/** Texto legível de um resultado parcial do streaming (objeto parcial do modelo), para a prévia visual (não é anunciada). */
export function partialText(p: unknown): string {
  if (typeof p === "string") return p;
  if (Array.isArray(p)) return p.map(partialText).filter(Boolean).join("\n");
  if (p && typeof p === "object") return Object.values(p).map(partialText).filter(Boolean).join("\n");
  return "";
}

type Ctx = { signal: AbortSignal; onPartial: (p: unknown) => void };

/**
 * Uma geração por vez, com um `AbortController` por chamada. `cancel` e o desmonte (fechar o painel) abortam.
 * Aborto não é erro: `run` devolve `undefined` e o estado volta a "parado".
 */
export function useAssistRun() {
  const [busy, setBusy] = useState(false);
  const [partial, setPartial] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const seq = useRef(0);

  const cancel = useCallback(() => {
    seq.current++;
    ctrl.current?.abort();
    ctrl.current = null;
    setBusy(false);
    setPartial("");
    setDone(false);
  }, []);

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = useCallback(async <T,>(fn: (ctx: Ctx) => Promise<T>): Promise<T | undefined> => {
    ctrl.current?.abort();
    const mine = ++seq.current;
    const c = new AbortController();
    ctrl.current = c;
    setBusy(true);
    setError(null);
    setDone(false);
    setPartial("");
    try {
      const out = await fn({
        signal: c.signal,
        onPartial: (p) => {
          if (seq.current === mine) setPartial(partialText(p));
        },
      });
      if (seq.current !== mine || c.signal.aborted) return undefined;
      setBusy(false);
      setPartial("");
      setDone(true);
      return out;
    } catch (e) {
      if (seq.current !== mine || c.signal.aborted || isAbortError(e)) return undefined;
      setBusy(false);
      setPartial("");
      setError(e instanceof AiError && e.code === "invalid_output" && e.meta?.violations ? ASSIST_INVENTED_MESSAGE : GENERIC_ERROR);
      return undefined;
    }
  }, []);

  return { busy, partial, error, done, run, cancel };
}
