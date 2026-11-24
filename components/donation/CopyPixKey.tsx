"use client";

import { useState } from "react";
import { BTN_OUTLINE } from "@/components/ui/styles";

type Status = "idle" | "copied" | "failed";

const MESSAGES: Record<Status, string> = {
  idle: "",
  copied: "Copiado!",
  failed: "Não foi possível copiar. Selecione e copie manualmente.",
};

/** Botão que copia um texto (chave Pix ou "copia e cola") e confirma numa região `aria-live`. */
export function CopyPixKey({ value, label }: { value: string; label: string }) {
  const [status, setStatus] = useState<Status>("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className={BTN_OUTLINE} onClick={() => void copy()}>
        {label}
      </button>
      <span role="status" aria-live="polite" className="text-[13px] text-jf-ink-2">
        {MESSAGES[status]}
      </span>
    </div>
  );
}
