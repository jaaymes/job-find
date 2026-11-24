export type LinkedInSearchFilters = {
  q?: string;
  stacks?: string[];
  workMode?: "remote" | "hybrid" | "onsite";
  seniority?: Array<"intern" | "junior" | "mid" | "senior" | "lead">;
  since?: "24h" | "7d" | "30d";
};

const BRAZIL_GEO_ID = "106057199";
const SINCE_SECONDS = { "24h": "r86400", "7d": "r604800", "30d": "r2592000" } as const;
const WORK_MODE = { remote: "2", hybrid: "3", onsite: "1" } as const;
const SENIORITY = { intern: "1", junior: "2", mid: "3", senior: "4", lead: "5" } as const;

/** Monta a URL de busca do LinkedIn a partir dos filtros. Só gera o link: o app nunca consulta o LinkedIn. */
export function buildLinkedInSearchUrl(f: LinkedInSearchFilters): string {
  const keywords = [f.q?.trim(), ...(f.stacks ?? [])].filter(Boolean).join(" ") || "desenvolvedor";
  const params = new URLSearchParams({ keywords, geoId: BRAZIL_GEO_ID, f_TPR: SINCE_SECONDS[f.since ?? "7d"] });
  if (f.workMode) params.set("f_WT", WORK_MODE[f.workMode]);
  if (f.seniority?.length) params.set("f_E", f.seniority.map((s) => SENIORITY[s]).join(","));
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}
