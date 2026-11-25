import type { Metadata } from "next";
import { JobDetail } from "@/components/jobs/JobDetail";
import { AppShell } from "@/components/layout/AppShell";

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
    <AppShell current="vagas" className="pt-4 sm:pt-6">
      <JobDetail id={id} />
    </AppShell>
  );
}
