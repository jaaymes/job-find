import type { Metadata } from "next";
import { Board } from "@/components/my-jobs/Board";

// Dados pessoais só no navegador; fora do índice dos buscadores.
export const metadata: Metadata = { title: "Job Find — Minhas vagas", robots: { index: false } };

export default function MinhasVagasPage() {
  return <Board />;
}
