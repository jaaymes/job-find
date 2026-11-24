import type { Metadata } from "next";
import { GeneratorScreen } from "@/components/generator/GeneratorScreen";

// Dados pessoais só no navegador; fora do índice dos buscadores.
export const metadata: Metadata = { title: "Job Find — Gerador de CV e carta", robots: { index: false } };

export default async function GeradorPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return <GeneratorScreen jobId={jobId} />;
}
