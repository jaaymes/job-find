"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "./AppShell";

/** `AppShell` das rotas (local): o gerador (`/gerador/*`) monta a própria barra de ação, então sem barra de abas. */
export function LocalShell({ children }: { children: ReactNode }) {
  const generator = usePathname().startsWith("/gerador/");
  return <AppShell tabBar={!generator}>{children}</AppShell>;
}
