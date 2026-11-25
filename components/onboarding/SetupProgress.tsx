"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { isLocalRoute } from "@/components/layout/nav";
import { aiSettingsStore } from "@/lib/client/ai/settings";
import { profileStore } from "@/lib/client/profile/store";
import { getSetupProgress, safeReturnPath, withReturn } from "@/lib/client/setup/progress";
import { useStore } from "@/lib/client/storage/store";
import { HardLink, type LocalRoute } from "@/components/ui/hard-link";
import { BTN_OUTLINE, BTN_PRIMARY } from "@/components/ui/styles";

type Variant = "banner" | "card" | "inline";

const WRAP: Record<Variant, string> = {
  banner: "flex flex-col gap-3 rounded-2xl border border-jf-line bg-jf-surface p-4 sm:flex-row sm:items-center",
  card: "flex flex-col gap-3 rounded-2xl border border-jf-line bg-jf-surface p-5",
  inline: "flex flex-wrap items-center gap-x-3 gap-y-2 text-sm",
};

/** Progresso do setup (IA, currículo). Some quando tudo está pronto ou enquanto os dados não hidratam. */
export function SetupProgress({ variant, returnTo }: { variant: Variant; returnTo?: string }) {
  const ai = useStore(aiSettingsStore);
  const profile = useStore(profileStore);
  const { step } = getSetupProgress(ai, profile);
  if (!ai || step === 3) return null;

  const body =
    step === 1
      ? "Conecte uma IA grátis com a sua própria chave. Depois, importe seu currículo."
      : "IA conectada. Falta importar seu currículo (PDF do LinkedIn ou DOCX) — leva 1 minuto.";
  const href = step === 1 ? withReturn("/configuracoes", returnTo ?? null) : withReturn("/perfil", returnTo ?? null);
  const cta = step === 1 ? "Conectar IA" : "Importar currículo";

  return (
    <section aria-label="Progresso da configuração" className={WRAP[variant]}>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold text-jf-ink">
          Veja sua chance em cada vaga
          <span className="rounded-full bg-jf-chip px-2 py-0.5 text-xs font-semibold text-jf-ink-2">{step}/3</span>
        </p>
        {variant !== "inline" && <p className="mt-1 text-sm text-jf-ink-3">{body}</p>}
      </div>
      {/* `withReturn` acrescenta só a query à rota local: o `as` mantém a navegação completa do HardLink. */}
      <HardLink href={href as LocalRoute} className={`${BTN_PRIMARY} w-fit no-underline`}>
        {cta}
      </HardLink>
    </section>
  );
}

const noopSubscribe = () => () => {};

/** `?voltar=` validado da URL atual; `null` no servidor, na hidratação e quando inválido. */
function useReturnTo(): string | null {
  const raw = useSyncExternalStore(
    noopSubscribe,
    () => new URLSearchParams(window.location.search).get("voltar"),
    () => null,
  );
  return safeReturnPath(raw);
}

/** "Voltar para a vaga": só aparece com `?voltar` válido. Rota `(local)` usa HardLink; a pública, `next/link`. */
export function ReturnToJobLink() {
  const returnTo = useReturnTo();
  if (!returnTo) return null;
  const cls = `${BTN_OUTLINE} w-fit no-underline`;
  return isLocalRoute(returnTo) ? (
    <HardLink href={returnTo} className={cls}>
      Voltar para a vaga
    </HardLink>
  ) : (
    <Link href={returnTo} className={cls}>
      Voltar para a vaga
    </Link>
  );
}
