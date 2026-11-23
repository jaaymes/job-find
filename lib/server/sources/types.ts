import "server-only";
import type { Seniority, WorkMode } from "@/lib/shared/types/job";

/** Vaga já normalizada por um conector, antes do enriquecimento (a Tarefa 10 completa este arquivo). */
export type NormalizedJob = {
  externalId: string;
  url: string;
  title: string;
  company: string;
  companyLogoUrl: string | null;
  descriptionHtml: string;
  descriptionFormat: "html" | "markdown";
  country: string | null;
  city: string | null;
  locationText: string | null;
  eligibleRegions: string[];
  workModeHint: WorkMode | null;
  seniorityHint: Seniority | null;
  tags: string[];
  salary: {
    min: number | null;
    max: number | null;
    currency: string;
    period: "hour" | "month" | "year";
  } | null;
  publishedAt: Date | null;
};
