"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { isStorageAvailable, storageUsageBytes } from "@/lib/client/storage/store";

/** Acima disso (cota típica do localStorage: ~5 MB) o usuário é avisado. */
const NEAR_LIMIT_BYTES = 4 * 1024 * 1024;

type State = "ok" | "unavailable" | "near-limit";

function subscribe(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

function getSnapshot(): State {
  if (!isStorageAvailable()) return "unavailable";
  return storageUsageBytes() > NEAR_LIMIT_BYTES ? "near-limit" : "ok";
}

/** Aviso de armazenamento: nada no servidor/hidratação; decide no cliente. */
export function StorageBanner() {
  const state = useSyncExternalStore<State | null>(subscribe, getSnapshot, () => null);

  if (state === null || state === "ok") return null;

  if (state === "unavailable") {
    return (
      <div
        role="alert"
        className="rounded-lg border border-jf-danger-fg/30 bg-jf-danger-bg px-4 py-3 text-[13px] leading-snug text-jf-danger-fg"
      >
        Não foi possível salvar neste navegador. A busca de vagas funciona normalmente.
      </div>
    );
  }

  return (
    <div
      role="status"
      className="rounded-lg border border-jf-new-fg/30 bg-jf-new-bg px-4 py-3 text-[13px] leading-snug text-jf-new-fg"
    >
      Seus dados estão perto do limite. Exporte um backup e apague CVs antigos.{" "}
      <Link href="/configuracoes" className="font-medium underline underline-offset-2">
        Ir para Configurações
      </Link>
    </div>
  );
}
