import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { SourcesPage } from "@/components/sources/SourcesPage";

export const metadata: Metadata = { title: "Job Find — Fontes" };

// Shell estático (D-01): sem acesso a banco no build; os dados vêm do cliente via /api/sources/status.
export default function FontesPage() {
  return (
    <AppShell current="fontes">
      <SourcesPage />
    </AppShell>
  );
}
