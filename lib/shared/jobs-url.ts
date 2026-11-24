import type { JobsQuery } from "@/lib/shared/schemas/jobs-query";

const DEFAULTS: Partial<JobsQuery> = { stacksMode: "any", limit: 30 };

/** URL canônica de `/api/jobs`: chaves em ordem alfabética, arrays ordenados, padrões omitidos. */
export function buildJobsUrl(q: Partial<JobsQuery>): string {
  const params = new URLSearchParams();
  const keys = (Object.keys(q) as (keyof JobsQuery)[]).sort();
  for (const key of keys) {
    const value = q[key];
    if (value === undefined || value === DEFAULTS[key]) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, [...value].sort().join(","));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `/api/jobs?${qs}` : "/api/jobs";
}
