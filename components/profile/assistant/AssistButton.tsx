"use client";

import { Sparkles } from "lucide-react";
import { BTN_OUTLINE } from "@/components/ui/styles";

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
    <button type="button" className={`${BTN_OUTLINE} min-h-11 w-fit gap-1.5 px-3 text-sm`} aria-label={label ? `${text}: ${label}` : undefined} onClick={onClick}>
      <Sparkles aria-hidden className="text-jf-brand" />
      {text}
    </button>
  );
}
