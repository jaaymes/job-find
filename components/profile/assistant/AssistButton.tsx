"use client";

import { BTN_OUTLINE } from "@/components/ui/styles";

type Props = {
  /** Campo vazio: o assistente entrevista ("Escrever"); preenchido: reescreve ("Melhorar"). */
  empty: boolean;
  onClick: () => void;
};

/** Botão que abre o assistente de IA para um campo do perfil. */
export function AssistButton({ empty, onClick }: Props) {
  return (
    <button type="button" className={`${BTN_OUTLINE} min-h-11 w-fit`} onClick={onClick}>
      {empty ? "Escrever com IA" : "Melhorar com IA"}
    </button>
  );
}
