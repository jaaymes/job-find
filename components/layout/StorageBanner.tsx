"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  probeStorage,
  STORAGE_CHANGE_EVENT,
  storageUsageBytes,
} from "@/lib/client/storage/store";

/** Acima disso (cota típica do localStorage: ~5 MB) o usuário é avisado. */
const NEAR_LIMIT_BYTES = 4 * 1024 * 1024;

type State = "ok" | "unavailable" | "near-limit";

function subscribe(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    // Ignora a chave de sonda e chaves de outros apps.
    if (e.key === null || e.key.startsWith("jobfind:v1:")) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(STORAGE_CHANGE_EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(STORAGE_CHANGE_EVENT, cb);
  };
}

function getSnapshot(): State {
  const probe = probeStorage();
  if (probe === "unavailable") return "unavailable";
  if (probe === "quota") return "near-limit";
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
      Seus dados estão perto do limite. Libere espaço no navegador apagando dados antigos do Job Find.{" "}
      <Link href="/configuracoes" className="font-medium underline underline-offset-2">
        Ir para Configurações
      </Link>
    </div>
  );
}
