"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useTheme } from "@/lib/client/theme/ThemeProvider";
import { cn } from "@/lib/utils";

const noSubscribe = () => () => {};

// 44px (size-11): alvo de toque mínimo. O placeholder tem o mesmo tamanho para não mexer no layout.
const BOX = "inline-flex size-11 shrink-0 items-center justify-center rounded-lg";

/**
 * Alterna entre tema claro e escuro. O servidor não sabe o tema (vem do localStorage/sistema),
 * então antes de montar renderiza só um espaço reservado, evitando divergência de hidratação.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, setPref } = useTheme();
  // false no servidor e na hidratação, true depois de montar no navegador.
  const mounted = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );

  if (!mounted) return <span aria-hidden="true" className={cn(BOX, className)} />;

  const dark = resolved === "dark";
  const Icon = dark ? Sun : Moon;
  return (
    <button
      type="button"
      aria-label={dark ? "Ativar tema claro" : "Ativar tema escuro"}
      aria-pressed={dark}
      onClick={() => setPref(dark ? "light" : "dark")}
      className={cn(
        BOX,
        "cursor-pointer text-jf-ink-2 outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-jf-brand",
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-5" />
    </button>
  );
}
