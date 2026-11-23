import type { ReactNode } from "react";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { StorageBanner } from "@/components/layout/StorageBanner";

// Páginas com dados pessoais do navegador (perfil, configurações): shell estático + aviso de armazenamento.
export default function LocalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader current="vagas" />
      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-5 px-4 pt-6 pb-16 sm:px-6 sm:pt-7">
        <StorageBanner />
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
