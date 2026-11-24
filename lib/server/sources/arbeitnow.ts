import "server-only";
import { z } from "@/lib/shared/zod";
import { safeUrl } from "@/lib/shared/url";
import type { Connector, ConnectorContext, NormalizedJob } from "@/lib/server/sources/types";

/** Host fixo da API: o fetch seguro só aceita URLs base definidas no código. */
export const ARBEITNOW_HOST = "www.arbeitnow.com";
const API_URL = `https://${ARBEITNOW_HOST}/api/job-board-api`;
/** Cada página traz 300 vagas (cerca de 2 MB), das quais só ~7% são remotas. */
const MAX_PAGES = 3;
/** As vagas apontam para o domínio do país do anúncio (mesma conta do job board). */
const JOB_HOSTS = /^www\.arbeitnow\.(com|co\.uk|fr|ch|nl)$/;

const pageSchema = z.object({
  data: z.array(z.unknown()),
  links: z.object({ next: z.string().nullish() }).nullish(),
});

export const jobSchema = z.object({
  slug: z.string().min(1),
  company_name: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().nullish(),
  remote: z.boolean(),
  url: z.string().min(1),
  tags: z.array(z.string()).nullish(),
  job_types: z.array(z.string()).nullish(),
  location: z.string().nullish(),
  /** Epoch em segundos. */
  created_at: z.number().nullish(),
});

async function* fetchPages(ctx: ConnectorContext): AsyncGenerator<unknown> {
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    // Sempre entrega pelo menos a primeira página; depois, respeita o prazo da fonte.
    if (page > 1 && Date.now() >= ctx.deadlineAt) return;
    ctx.signal.throwIfAborted();
    const res = await ctx.fetchJson(`${API_URL}?page=${page}`, { signal: ctx.signal });
    if (res.status !== 200) throw new Error(`Arbeitnow respondeu ${res.status}`);
    const parsed = pageSchema.safeParse(await res.json());
    if (!parsed.success) throw new Error("Arbeitnow: resposta fora do formato esperado");

    for (const raw of parsed.data.data) {
      const job = jobSchema.safeParse(raw);
      if (!job.success || !job.data.remote) continue;
      if (seen.has(job.data.slug)) continue;
      seen.add(job.data.slug);
      yield raw;
    }
    if (!parsed.data.links?.next || parsed.data.data.length === 0) return;
  }
}

export const arbeitnow: Connector = {
  id: "arbeitnow",
  brazilian: false,
  // Lista as vagas mais novas primeiro e o projeto lê só 3 páginas: não dá para expirar por ausência.
  fullSnapshot: false,
  minIntervalMinutes: 60,
  allowedHosts: [ARBEITNOW_HOST],
  attribution: { label: "Arbeitnow", url: `https://${ARBEITNOW_HOST}`, dofollow: false },
  fetch: fetchPages,
  normalize(raw): NormalizedJob | null {
    const parsed = jobSchema.safeParse(raw);
    if (!parsed.success) return null;
    const j = parsed.data;
    if (!j.remote) return null;
    const url = safeUrl(j.url);
    if (!url || !JOB_HOSTS.test(new URL(url).hostname)) return null;

    const published = j.created_at ? new Date(j.created_at * 1000) : null;
    return {
      externalId: j.slug,
      url,
      title: j.title,
      company: j.company_name,
      companyLogoUrl: null,
      descriptionHtml: j.description ?? "",
      descriptionFormat: "html",
      country: null,
      city: null,
      locationText: j.location?.trim() || null,
      eligibleRegions: [],
      workModeHint: "remote",
      seniorityHint: null,
      tags: [...new Set([...(j.tags ?? []), ...(j.job_types ?? [])].map((t) => t.trim()).filter(Boolean))],
      salary: null,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
    };
  },
};
