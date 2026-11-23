import type { Violation } from "@/lib/client/cv/validate";

/** Motivo da violação em linguagem simples, para quem não conhece os ids internos do perfil. */
export function describeViolation(v: Violation): string {
  switch (v.kind) {
    case "unknown_exp":
      return v.text === "sem fonte"
        ? "Este trecho não indica de qual parte do seu perfil ele vem."
        : "Este trecho cita uma fonte que não existe nesta experiência do seu perfil.";
    case "unknown_skill":
      return `A competência "${v.text}" não está no seu perfil.`;
    case "unknown_stack":
      return `A tecnologia "${v.text}" não aparece no seu perfil.`;
    case "unknown_year":
      return `O ano ${v.text} não aparece no seu perfil.`;
    case "unknown_number":
      return `O número "${v.text}" não aparece no seu perfil.`;
    case "unknown_name":
      return v.where.part === "letter"
        ? `O termo "${v.text}" não aparece no seu perfil nem na vaga.`
        : `O termo "${v.text}" não aparece no seu perfil.`;
  }
}

export function whereText(v: Violation): string {
  if (v.where.part === "letter") return "Carta";
  if (v.where.bulletIndex !== undefined) return `Bullet ${v.where.bulletIndex + 1}`;
  return "CV";
}
