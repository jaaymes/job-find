import type { Metadata } from "next";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { SourcesPage } from "@/components/sources/SourcesPage";

export const metadata: Metadata = { title: "Job Find — Fontes" };

// Shell estático (D-01): sem acesso a banco no build; os dados vêm do cliente via /api/sources/status.
export default function FontesPage() {
  return (
    <>
      <SiteHeader />
      <main id="conteudo" className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-5 px-4 pt-6 pb-16 sm:px-6 sm:pt-7">
        <SourcesPage />
      </main>
      <SiteFooter />
    </>
  );
}
