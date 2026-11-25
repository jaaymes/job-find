import type { Metadata } from "next";
import { JobDetail } from "@/components/jobs/JobDetail";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";

// Fora do índice dos buscadores: o conteúdo é das fontes, e algumas proíbem repassá-lo ao Google (D-07).
export const metadata: Metadata = { title: "Job Find — Detalhe da vaga", robots: { index: false } };

// Cada id é renderizado uma vez, sob demanda, e fica em cache; nenhum id é pré-gerado no build.
export function generateStaticParams(): { id: string }[] {
  return [];
}

// Shell estático (D-01): sem acesso a banco nem fetch aqui; os dados vêm do cliente via /api/jobs/{id}.
export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <SiteHeader current="vagas" />
      <main id="conteudo" className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-5 px-4 pt-4 pb-16 sm:px-6 sm:pt-6">
        <JobDetail id={id} />
      </main>
      <SiteFooter />
    </>
  );
}
