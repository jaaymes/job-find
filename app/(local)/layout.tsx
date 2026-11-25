import { connection } from "next/server";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { StorageBanner } from "@/components/layout/StorageBanner";

// Páginas com dados pessoais do navegador (perfil, configurações): aviso de armazenamento.
// Renderização dinâmica por requisição: o Next só aplica o nonce do proxy.ts (CSP) assim.
export default async function LocalLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <AppShell>
      <StorageBanner />
      {children}
    </AppShell>
  );
}
