import "server-only";
import { z } from "@/lib/shared/zod";
import { safeUrl } from "@/lib/shared/url";
import type { Seniority } from "@/lib/shared/types/job";
import { parseLocation } from "@/lib/server/sources/location";
import type { Connector, ConnectorContext, NormalizedJob } from "@/lib/server/sources/types";

/**
 * Vagas do LinkedIn pelo actor `valig/linkedin-jobs-scraper` do Apify (US$ 0,40 por 1.000 vagas,
 * até 1.000 por execução). O plano grátis do Apify dá US$ 5 por mês e bloqueia o uso, sem cobrar,
 * quando o crédito acaba. Sem `APIFY_TOKEN` a fonte não faz nada.
 *
 * Cada coleta (cron de hora em hora): lista as execuções do actor, ingere o dataset da última que
 * terminou com sucesso (uma vez só, pelo cursor) e, se a última começou há mais de
 * `RUN_EVERY_HOURS`, inicia outra. Assim a coleta nunca espera o actor terminar.
 */
export const APIFY_HOST = "api.apify.com";
export const LINKEDIN_ACTOR = "valig~linkedin-jobs-scraper";
const ACTOR_URL = `https://${APIFY_HOST}/v2/acts/${LINKEDIN_ACTOR}`;

/** Duas execuções por dia. */
export const RUN_EVERY_HOURS = 12;
/** Vagas por execução: 2 × 30 × 200 = 12.000 vagas/mês, cerca de US$ 4,80 dos US$ 5 grátis. */
export const RESULTS_PER_RUN = 200;
/** Teto de gasto por execução, cobrado pelo Apify mesmo que o actor traga mais itens. */
export const MAX_CHARGE_PER_RUN_USD = 0.08;

/** Buscas em rodízio, uma por execução; o filtro RN-01 descarta o que não for de tecnologia. */
export const LINKEDIN_KEYWORDS = [
  "desenvolvedor",
  "software engineer",
  "desenvolvedor front-end",
  "desenvolvedor back-end",
  "engenheiro de dados",
  "devops",
  "desenvolvedor mobile",
  "analista de sistemas",
] as const;

const runsSchema = z.object({
  data: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        status: z.string(),
        startedAt: z.string().nullish(),
        defaultDatasetId: z.string().nullish(),
      }),
    ),
  }),
});

export const jobSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  url: z.string().min(1),
  title: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  location: z.string().nullish(),
  experienceLevel: z.string().nullish(),
  contractType: z.string().nullish(),
  description: z.string().nullish(),
  descriptionHtml: z.string().nullish(),
  postedDate: z.string().nullish(),
});

const ACTIVE_STATUSES = new Set(["READY", "RUNNING"]);

const SENIORITY: Record<string, Seniority> = {
  internship: "intern",
  "entry level": "junior",
  director: "lead",
  executive: "lead",
};

/** Índice da busca da janela atual: muda a cada `RUN_EVERY_HOURS`. */
export function keywordFor(now: Date): string {
  const slot = Math.floor(now.getTime() / (RUN_EVERY_HOURS * 3_600_000));
  return LINKEDIN_KEYWORDS[slot % LINKEDIN_KEYWORDS.length]!;
}

async function* fetchLinkedin(ctx: ConnectorContext): AsyncGenerator<unknown> {
  const token = process.env.APIFY_TOKEN?.trim();
  if (!token) return;
  const auth = { Authorization: `Bearer ${token}` };

  const listUrl = new URL(`${ACTOR_URL}/runs`);
  listUrl.searchParams.set("desc", "true");
  listUrl.searchParams.set("limit", "10");
  const listRes = await ctx.fetchJson(listUrl.toString(), { headers: auth, signal: ctx.signal });
  const runs = runsSchema.safeParse(await listRes.json());
  if (!runs.success) throw new Error("Apify: lista de execuções fora do formato esperado");
  const items = runs.data.data.items;

  const done = items.find((r) => r.status === "SUCCEEDED" && r.defaultDatasetId);
  if (done && done.defaultDatasetId !== ctx.cursor) {
    const dsUrl = new URL(`https://${APIFY_HOST}/v2/datasets/${encodeURIComponent(done.defaultDatasetId!)}/items`);
    dsUrl.searchParams.set("clean", "true");
    dsUrl.searchParams.set("format", "json");
    dsUrl.searchParams.set("limit", "1000");
    const dsRes = await ctx.fetchJson(dsUrl.toString(), { headers: auth, signal: ctx.signal });
    const data = await dsRes.json();
    if (!Array.isArray(data)) throw new Error("Apify: dataset fora do formato esperado");
    for (const raw of data) yield raw;
    ctx.setCursor(done.defaultDatasetId!);
  }

  const latest = items[0];
  const startedAt = latest?.startedAt ? new Date(latest.startedAt).getTime() : Number.NaN;
  const due =
    !latest ||
    (!ACTIVE_STATUSES.has(latest.status) &&
      (Number.isNaN(startedAt) || ctx.now.getTime() - startedAt >= RUN_EVERY_HOURS * 3_600_000 - 60_000));
  if (!due) return;

  const startUrl = new URL(`${ACTOR_URL}/runs`);
  startUrl.searchParams.set("maxItems", String(RESULTS_PER_RUN));
  startUrl.searchParams.set("maxTotalChargeUsd", String(MAX_CHARGE_PER_RUN_USD));
  const input = { keywords: keywordFor(ctx.now), location: "Brazil", datePosted: "r86400", limit: RESULTS_PER_RUN };
  await ctx.fetchJson(startUrl.toString(), {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify(input),
    signal: ctx.signal,
  });
}

function isLinkedinUrl(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return host === "linkedin.com" || host.endsWith(".linkedin.com");
}

export const linkedin: Connector = {
  id: "linkedin",
  brazilian: false,
  // Só traz as vagas das últimas 24 h de cada busca: as antigas expiram pela idade.
  fullSnapshot: false,
  minIntervalMinutes: 60,
  allowedHosts: [APIFY_HOST],
  attribution: { label: "LinkedIn", url: "https://www.linkedin.com/jobs", dofollow: false },
  fetch: fetchLinkedin,
  normalize(raw): NormalizedJob | null {
    const parsed = jobSchema.safeParse(raw);
    if (!parsed.success) return null;
    const j = parsed.data;
    const url = safeUrl(j.url);
    if (!url || !isLinkedinUrl(url)) return null;

    const loc = j.location?.trim() ? parseLocation(j.location) : null;
    const published = j.postedDate ? new Date(j.postedDate) : null;
    const html = j.descriptionHtml?.trim();
    return {
      externalId: j.id,
      url,
      title: j.title,
      company: j.companyName,
      companyLogoUrl: null,
      descriptionHtml: html || j.description?.trim() || "",
      descriptionFormat: html ? "html" : "markdown",
      country: loc?.country ?? null,
      city: loc?.city ?? null,
      locationText: j.location?.trim() || null,
      eligibleRegions: loc?.regions ?? [],
      workModeHint: loc?.workMode ?? null,
      seniorityHint: SENIORITY[(j.experienceLevel ?? "").trim().toLowerCase()] ?? null,
      tags: j.contractType?.trim() ? [j.contractType.trim()] : [],
      salary: null,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
    };
  },
};
