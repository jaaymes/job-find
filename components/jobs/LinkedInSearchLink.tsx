import { buildLinkedInSearchUrl } from "@/lib/client/jobs/linkedin-search";
import type { PageFilters } from "@/lib/client/jobs/use-jobs";

/** Link externo para a mesma busca no LinkedIn; o app não faz requisição ao LinkedIn. */
export function LinkedInSearchLink({ filters }: { filters: PageFilters }) {
  const { q, stacks, workMode, seniority, since } = filters;
  return (
    <a
      href={buildLinkedInSearchUrl({ q, stacks, workMode, seniority, since })}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 items-center self-start rounded-lg px-1 text-sm font-semibold text-jf-brand underline outline-none hover:text-jf-brand-dark focus-visible:ring-2 focus-visible:ring-jf-brand"
    >
      Buscar também no LinkedIn
    </a>
  );
}
