import { CARD } from "@/components/ui/styles";
import type { Violation } from "@/lib/client/cv/validate";
import { describeViolation, whereText } from "./violation-text";

/**
 * `TailoredDocs` não traz requisitos nem lacunas da vaga (a análise de aderência está em "Análise com IA"),
 * então este painel lista, em linguagem simples, o que o validador achou no texto gerado.
 */
export function GapsPanel({
  violations,
  approvedFlags,
  removedExperiences,
}: {
  violations: Violation[];
  approvedFlags: string[];
  removedExperiences: number;
}) {
  return (
    <section aria-labelledby="gaps-t" className={`${CARD} flex flex-col gap-2.5 p-5`}>
      <h2 id="gaps-t" className="text-base font-semibold">
        Pontos de atenção
      </h2>
      {violations.length === 0 && removedExperiences === 0 ? (
        <p className="text-sm text-jf-ink-3">O texto gerado só usa fatos do seu perfil.</p>
      ) : (
        <ul className="flex list-disc flex-col gap-1.5 pl-[18px] text-sm leading-relaxed">
          {removedExperiences > 0 && (
            <li>
              {removedExperiences === 1
                ? "Uma experiência gerada não existe no seu perfil e foi removida."
                : `${removedExperiences} experiências geradas não existem no seu perfil e foram removidas.`}
            </li>
          )}
          {violations.map((v, i) => (
            <li key={`${v.key}-${i}`}>
              <strong>{whereText(v)}:</strong> {describeViolation(v)}
              {approvedFlags.includes(v.key) && <span className="text-jf-ink-3"> (aprovado por você)</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
