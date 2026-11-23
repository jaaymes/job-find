import { Suspense } from "react";
import { JobsPage, JobsPageFallback } from "@/components/jobs/JobsPage";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";

// Shell estático (D-01): os dados vêm do cliente via /api/jobs.
export default function HomePage() {
  return (
    <>
      <SiteHeader current="vagas" />
      <main className="mx-auto flex w-full max-w-[1280px] flex-1 flex-col gap-5 px-4 pt-6 pb-16 sm:px-6 sm:pt-7">
        {/* useSearchParams (nuqs) exige Suspense para manter a página pré-renderizada. */}
        <Suspense fallback={<JobsPageFallback />}>
          <JobsPage />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
