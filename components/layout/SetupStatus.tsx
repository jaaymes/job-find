"use client";

import { aiSettingsStore } from "@/lib/client/ai/settings";
import { profileStore } from "@/lib/client/profile/store";
import { getSetupProgress } from "@/lib/client/setup/progress";
import { useStore } from "@/lib/client/storage/store";
import { HardLink } from "@/components/ui/hard-link";

/** Estado do setup no header (a partir de `lg`): "IA conectada · Currículo pendente". Some com tudo pronto. */
export function SetupStatus() {
  const ai = useStore(aiSettingsStore);
  const profile = useStore(profileStore);
  const { aiReady, cvReady, step } = getSetupProgress(ai, profile);
  if (!ai || step === 3) return null;
  const href = step === 1 ? "/configuracoes" : "/perfil";
  return (
    <HardLink
      href={href}
      className="hidden items-center rounded-full border border-jf-line-strong px-3 py-1.5 text-[13px] text-jf-ink-2 no-underline outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-jf-brand lg:inline-flex"
    >
      {aiReady ? "IA conectada" : "IA pendente"} · {cvReady ? "Currículo importado" : "Currículo pendente"}
    </HardLink>
  );
}
