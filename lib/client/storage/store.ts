import "client-only";

import { useSyncExternalStore } from "react";
import type { z } from "@/lib/shared/zod";
import { STORAGE_PREFIX, type StorageKey } from "./keys";

/** Notificação na mesma aba (o evento nativo `storage` só dispara em outras abas). */
export const STORAGE_CHANGE_EVENT = "jobfind:storage";

export type SetResult = { ok: true } | { ok: false; reason: "quota" | "unavailable" };

export type Store<T> = {
  get(): T;
  set(v: T): SetResult;
  subscribe(cb: () => void): () => void;
};

type Options<T> = {
  version: number;
  migrations?: Record<number, (old: unknown) => unknown>;
  initial: T;
};

function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === "QuotaExceededError" ||
      e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      e.code === 22 ||
      e.code === 1014)
  );
}

/**
 * Store tipada sobre uma chave do localStorage. Formato gravado: `{ v, data }`.
 * Leitura: JSON.parse -> migrações vN->vN+1 -> schema.safeParse; qualquer falha
 * devolve `initial`. `get()` devolve a mesma referência enquanto o texto
 * gravado não mudar (exigência do useSyncExternalStore).
 */
export function createStore<T>(
  key: StorageKey,
  schema: z.ZodType<T>,
  opts: Options<T>,
): Store<T> {
  const { version, migrations = {}, initial } = opts;
  const listeners = new Set<() => void>();
  let cache: { raw: string | null; value: T } = { raw: null, value: initial };

  function parse(raw: string): T {
    try {
      const env: unknown = JSON.parse(raw);
      if (typeof env !== "object" || env === null || Array.isArray(env)) return initial;
      const { v, data } = env as { v?: unknown; data?: unknown };
      if (typeof v !== "number" || !Number.isInteger(v) || v > version) return initial;
      let current: unknown = data;
      for (let n = v; n < version; n++) {
        const migrate = migrations[n];
        if (!migrate) return initial;
        current = migrate(current);
      }
      const result = schema.safeParse(current);
      return result.success ? result.data : initial;
    } catch {
      return initial;
    }
  }

  function get(): T {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return initial;
    }
    if (raw === null) return initial;
    if (raw !== cache.raw) cache = { raw, value: parse(raw) };
    return cache.value;
  }

  function set(v: T): SetResult {
    try {
      window.localStorage.setItem(key, JSON.stringify({ v: version, data: v }));
    } catch (e) {
      return { ok: false, reason: isQuotaError(e) ? "quota" : "unavailable" };
    }
    listeners.forEach((cb) => cb());
    window.dispatchEvent(new CustomEvent(STORAGE_CHANGE_EVENT));
    return { ok: true };
  }

  function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key || e.key === null) cb();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(cb);
      window.removeEventListener("storage", onStorage);
    };
  }

  return { get, set, subscribe };
}

/** Lê a store no cliente; `null` no servidor e na hidratação (a UI mostra skeleton). */
export function useStore<T>(s: Store<T>): T | null {
  return useSyncExternalStore<T | null>(s.subscribe, s.get, () => null);
}

/** Bytes aproximados (UTF-16: 2 bytes por caractere) ocupados pelas chaves `jobfind:`. */
export function storageUsageBytes(): number {
  try {
    const ls = window.localStorage;
    let chars = 0;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k === null || !k.startsWith(STORAGE_PREFIX)) continue;
      chars += k.length + (ls.getItem(k)?.length ?? 0);
    }
    return chars * 2;
  } catch {
    return 0;
  }
}

export type StorageProbe = "ok" | "quota" | "unavailable";

let probeCache: StorageProbe | null = null;

/**
 * Testa uma única vez por carregamento de página se o localStorage aceita gravações.
 * Cota cheia (QuotaExceededError) é "quota", não "unavailable". O resultado é
 * cacheado: chamadas seguintes não escrevem (evita laços de eventos `storage`).
 */
export function probeStorage(): StorageProbe {
  if (probeCache !== null) return probeCache;
  const probe = "jobfind:probe";
  try {
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    probeCache = "ok";
  } catch (e) {
    probeCache = isQuotaError(e) ? "quota" : "unavailable";
  }
  return probeCache;
}

/** Somente para testes: descarta o resultado cacheado da sonda. */
export function resetStorageProbeForTests(): void {
  probeCache = null;
}
