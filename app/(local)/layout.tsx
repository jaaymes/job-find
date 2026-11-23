import { connection } from "next/server";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { LocalHeader } from "@/components/layout/LocalHeader";
import { StorageBanner } from "@/components/layout/StorageBanner";

// Páginas com dados pessoais do navegador (perfil, configurações): aviso de armazenamento.
// Renderização dinâmica por requisição: o Next só aplica o nonce do proxy.ts (CSP) assim.
export default async function LocalLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <>
      <LocalHeader />
      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-5 px-4 pt-6 pb-16 sm:px-6 sm:pt-7">
        <StorageBanner />
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
