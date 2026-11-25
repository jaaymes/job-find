import { Suspense } from "react";
import { JobsPage, JobsPageFallback } from "@/components/jobs/JobsPage";
import { AppShell } from "@/components/layout/AppShell";
import { StorageBanner } from "@/components/layout/StorageBanner";

// Shell estático (D-01): os dados vêm do cliente via /api/jobs.
export default function HomePage() {
  return (
    <AppShell current="vagas">
      <StorageBanner />
      {/* useSearchParams (nuqs) exige Suspense para manter a página pré-renderizada. */}
      <Suspense fallback={<JobsPageFallback />}>
        <JobsPage />
      </Suspense>
    </AppShell>
  );
}
