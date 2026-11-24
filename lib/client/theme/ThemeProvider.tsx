"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { THEME_STORAGE_KEY, type ThemePref } from "@/lib/shared/theme-script";

export type { ThemePref };

export type ResolvedTheme = "light" | "dark";

type ThemeContextValue = {
  pref: ThemePref;
  resolved: ResolvedTheme;
  setPref: (p: ThemePref) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isThemePref(v: unknown): v is ThemePref {
  return v === "light" || v === "dark" || v === "system";
}

function readStoredPref(): ThemePref {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePref(v) ? v : "system";
  } catch {
    return "system";
  }
}

function getMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(DARK_QUERY);
  } catch {
    return null;
  }
}

function readSystemDark(): boolean {
  return getMediaQuery()?.matches ?? false;
}

function subscribeSystem(onChange: () => void): () => void {
  const mql = getMediaQuery();
  if (!mql) return () => {};
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

const noSubscribe = () => () => {};

/**
 * Guarda a preferência de tema e aplica a classe `dark` e o `color-scheme` no <html>.
 * No servidor `pref`/`resolved` saem como "system"/"light"; no navegador já nascem com os valores
 * reais (localStorage e matchMedia), iguais aos que o THEME_SCRIPT aplicou antes da hidratação,
 * então o efeito abaixo não troca o tema ao montar. Como o servidor não sabe o tema, quem mostra
 * `pref`/`resolved` na tela deve renderizar só depois de montar (senão há divergência de hidratação).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(readStoredPref);
  // Escuta o sistema só quando a preferência é "system". O terceiro argumento também é
  // readSystemDark: no servidor dá "claro" (sem window) e na hidratação já lê o valor real, para o
  // efeito abaixo não tirar por um instante a classe `dark` que o THEME_SCRIPT aplicou.
  const systemDark = useSyncExternalStore(
    pref === "system" ? subscribeSystem : noSubscribe,
    readSystemDark,
    readSystemDark,
  );

  const resolved: ResolvedTheme = pref === "system" ? (systemDark ? "dark" : "light") : pref;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, p);
    } catch {
      // Navegador sem armazenamento: o tema vale só nesta sessão.
    }
  }, []);

  const value = useMemo(() => ({ pref, resolved, setPref }), [pref, resolved, setPref]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme precisa estar dentro de <ThemeProvider>");
  return ctx;
}
