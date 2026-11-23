export type WorkMode = "remote" | "hybrid" | "onsite" | "unknown";

export type Seniority = "intern" | "junior" | "mid" | "senior" | "lead";

export type SourceId =
  | "himalayas"
  | "greenhouse"
  | "ashby"
  | "lever"
  | "jobicy"
  | "github"
  | "wwr"
  | "remoteok"
  | "hn"
  | "smartrecruiters";

export type JobOrigin = "national" | "international" | "unknown";

export type SalaryPeriod = "hour" | "month" | "year";

/** Linha da listagem (colunas do SELECT da listagem, sem `description_html`). */
export type JobSummary = {
  id: number;
  title: string;
  company: string;
  companyLogoUrl: string | null;
  summary: string;
  country: string | null;
  city: string | null;
  origin: JobOrigin;
  acceptsBrazil: boolean | null;
  workMode: WorkMode;
  seniority: Seniority | null;
  language: string;
  stacks: string[];
  sources: SourceId[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  /** ISO 8601, seguro para JSON. */
  publishedAt: string;
};

export type JobAttribution = {
  source: SourceId;
  label: string;
  url: string;
  dofollow: boolean;
};

export type JobDetail = JobSummary & {
  urlCanonical: string;
  /** HTML já sanitizado na ingestão. */
  descriptionHtml: string;
  attribution: JobAttribution[];
};
