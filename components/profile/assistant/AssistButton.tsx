"use client";

import { Sparkles } from "lucide-react";
import { BTN_OUTLINE } from "@/components/ui/styles";
import { cn } from "@/lib/utils";

type Props = {
  /** Campo vazio: o assistente entrevista ("Escrever"); preenchido: reescreve ("Melhorar"). */
  empty: boolean;
  onClick: () => void;
  /** Contexto para o nome acessível (ex.: "Título profissional"), já que vários botões têm o mesmo texto visível. */
  label?: string;
};

/** Botão que abre o assistente de IA para um campo do perfil. */
export function AssistButton({ empty, onClick, label }: Props) {
  const text = empty ? "Escrever com IA" : "Melhorar com IA";
  return (
    <button type="button" className={cn(BTN_OUTLINE, "h-auto min-h-11 w-fit max-w-full gap-1.5 px-3 py-2 text-left text-sm whitespace-normal")} aria-label={label ? `${text}: ${label}` : undefined} onClick={onClick}>
      <Sparkles aria-hidden className="text-jf-brand" />
      {text}
    </button>
  );
}
