"use client";

import { hasUsableProvider } from "@/lib/client/ai/model";
import type { AiTask } from "@/lib/client/ai/providers";
import { aiSettingsStore } from "@/lib/client/ai/settings";
import { useStore } from "@/lib/client/storage/store";
import { HardLink } from "@/components/ui/hard-link";

/** Convite para conectar uma IA; some quando a tarefa já tem um provedor utilizável. */
export function NoProviderCta({ task }: { task: AiTask }) {
  const settings = useStore(aiSettingsStore);
  if (!settings || hasUsableProvider(settings, task)) return null;
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-jf-line bg-jf-surface p-5">
      <p className="text-sm text-jf-ink-3">
        Ler o currículo, analisar vagas e gerar CVs usam a IA que você conectar, com a sua própria chave.
      </p>
      <HardLink
        href="/configuracoes"
        className="w-fit inline-flex min-h-11 items-center rounded-lg bg-jf-brand px-4 text-sm font-semibold text-jf-on-brand no-underline outline-none hover:bg-jf-brand-dark focus-visible:ring-2 focus-visible:ring-jf-brand focus-visible:ring-offset-2"
      >
        Conecte uma IA em Configurações
      </HardLink>
    </div>
  );
}
