"use client";

import Link from "next/link";
import { isConnected } from "@/lib/client/ai/model";
import { PROVIDER_IDS } from "@/lib/client/ai/providers";
import { aiSettingsStore } from "@/lib/client/ai/settings";
import { useStore } from "@/lib/client/storage/store";

/** Convite para conectar uma IA; some quando já há algum provedor conectado. */
export function NoProviderCta() {
  const settings = useStore(aiSettingsStore);
  if (!settings || PROVIDER_IDS.some((id) => isConnected(settings, id))) return null;
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-jf-line bg-jf-surface p-5">
      <p className="text-sm text-jf-ink-3">
        Ler o currículo, analisar vagas e gerar CVs usam a IA que você conectar, com a sua própria chave.
      </p>
      <Link
        href="/configuracoes"
        className="w-fit rounded-lg bg-jf-brand px-4 py-2.5 text-sm font-semibold text-white no-underline outline-none hover:bg-jf-brand-dark focus-visible:ring-2 focus-visible:ring-jf-brand focus-visible:ring-offset-2"
      >
        Conecte uma IA em Configurações
      </Link>
    </div>
  );
}
