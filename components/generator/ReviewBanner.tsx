"use client";

/** Aviso de revisão (RN-07): `aria-live` educado, para o leitor de tela anunciar a mudança da contagem. */
export function ReviewBanner({ count, removedExperiences }: { count: number; removedExperiences: number }) {
  const tone = count > 0 ? "border-jf-warn-line bg-jf-new-bg text-jf-new-fg" : "border-jf-line bg-jf-surface text-jf-ink-2";
  return (
    <div role="status" className={`flex flex-col gap-1 rounded-xl border px-4 py-3 text-sm ${tone}`}>
      <p className="font-semibold">
        {count === 0
          ? "Nenhum trecho precisa de revisão."
          : count === 1
            ? "1 trecho precisa da sua revisão"
            : `${count} trechos precisam da sua revisão`}
      </p>
      {count > 0 && (
        <p>Trechos com informação que não está no seu perfil ficam fora do PDF até você aprová-los ou corrigi-los.</p>
      )}
      {removedExperiences > 0 && (
        <p>
          {removedExperiences === 1
            ? "Uma experiência gerada não existe no seu perfil e foi removida."
            : `${removedExperiences} experiências geradas não existem no seu perfil e foram removidas.`}
        </p>
      )}
    </div>
  );
}
