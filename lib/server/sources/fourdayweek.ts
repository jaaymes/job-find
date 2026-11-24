import "server-only";
import { z } from "@/lib/shared/zod";
import { safeUrl } from "@/lib/shared/url";
import type { Seniority } from "@/lib/shared/types/job";
import type { Connector, ConnectorContext, NormalizedJob } from "@/lib/server/sources/types";

/** Host fixo da API: o fetch seguro só aceita URLs base definidas no código. */
export const FOURDAYWEEK_HOST = "4dayweek.io";
const API_URL = `https://${FOURDAYWEEK_HOST}/api/v2/jobs`;
const PAGE_SIZE = 100;
/** Teto de páginas por execução, somando a consulta Brasil e a remota (limite da API: 60 req/min por IP). */
const MAX_PAGES = 12;

/**
 * A consulta Brasil é relida inteira a cada execução e a remota dá a volta no catálogo (~4 mil vagas,
 * 9 a 12 páginas por execução) em cerca de 5 execuções. 24 h é um teto folgado acima desse ciclo:
 * vaga não vista há mais que isso fechou na origem e passa a contar coleta perdida.
 */
const REVISITS_CATALOG_WITHIN_HOURS = 24;

const BRAZIL_CATEGORIES = "engineering,data,security,product,design";
const REMOTE_CATEGORIES = "engineering,data,security";

const pageSchema = z.object({
  data: z.array(z.unknown()),
  has_more: z.boolean().nullish(),
});

const cursorSchema = z.object({ remotePage: z.number().int().min(1) });

const locationSchema = z.object({
  country: z.string().nullish(),
  continent: z.string().nullish(),
  city: z.string().nullish(),
});

const nameSchema = z.object({ name: z.string().trim().min(1) });

export const jobSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1),
  url: z.string().min(1),
  description: z.string().nullish(),
  level: z.string().nullish(),
  work_arrangement: z.string().nullish(),
  locations: z.array(locationSchema).nullish(),
  skills: z.array(nameSchema).nullish(),
  stack: z.array(nameSchema).nullish(),
  // Em centavos da moeda informada.
  salary_min: z.number().nullish(),
  salary_max: z.number().nullish(),
  salary_currency: z.string().nullish(),
  salary_period: z.string().nullish(),
  posted_at: z.string().nullish(),
  company: z
    .object({ name: z.string().trim().min(1), logo_url: z.string().nullish() })
    .nullish(),
});

const SENIORITY: Record<string, Seniority> = { entry: "junior", mid: "mid", senior: "senior", lead: "lead" };
const WORK_MODE = { remote: "remote", hybrid: "hybrid", onsite: "onsite" } as const;
const SALARY_PERIOD = { year: "year", month: "month", hour: "hour" } as const;

function mapSalary(j: z.infer<typeof jobSchema>): NormalizedJob["salary"] {
  const period = SALARY_PERIOD[(j.salary_period ?? "").toLowerCase() as keyof typeof SALARY_PERIOD];
  const min = j.salary_min && j.salary_min > 0 ? j.salary_min / 100 : null;
  const max = j.salary_max && j.salary_max > 0 ? j.salary_max / 100 : null;
  if (!period || (min === null && max === null)) return null;
  return { min, max, currency: (j.salary_currency ?? "USD").toUpperCase(), period };
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function readRemotePage(cursor: string | null): number {
  if (!cursor) return 1;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(cursor));
    return parsed.success ? parsed.data.remotePage : 1;
  } catch {
    return 1;
  }
}

async function* fetchPages(ctx: ConnectorContext): AsyncGenerator<unknown> {
  let used = 0;
  // Vaga remota com local no Brasil aparece nas duas consultas: emite cada id uma só vez por execução.
  const seen = new Set<string>();
  const outOfBudget = () => used >= MAX_PAGES || Date.now() >= ctx.deadlineAt;

  async function* query(params: Record<string, string>, startPage: number): AsyncGenerator<unknown, number | null> {
    // Devolve a próxima página a buscar, ou null quando a consulta acabou.
    let page = startPage;
    while (!outOfBudget() || used === 0) {
      const url = new URL(API_URL);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("page", String(page));
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

      used++;
      const res = await ctx.fetchJson(url.toString(), { signal: ctx.signal });
      if (res.status !== 200) throw new Error(`4dayweek respondeu ${res.status}`);
      const parsed = pageSchema.safeParse(await res.json());
      if (!parsed.success) throw new Error("4dayweek: resposta fora do formato esperado");

      for (const raw of parsed.data.data) {
        const id = (raw as { id?: unknown } | null)?.id;
        if (typeof id === "string") {
          if (seen.has(id)) continue;
          seen.add(id);
        }
        yield raw;
      }

      if (!parsed.data.has_more || parsed.data.data.length === 0) return null;
      page++;
    }
    return page;
  }

  // 1) Brasil inteira: poucas vagas, todas as execuções. Se o teto cortar aqui, a remota fica para a próxima.
  const brazil = query({ country: "Brazil", category: BRAZIL_CATEGORIES }, 1);
  while (true) {
    const step = await brazil.next();
    if (step.done) {
      if (step.value !== null) return;
      break;
    }
    yield step.value;
  }
  if (outOfBudget()) return;

  // 2) Remota: continua da página do cursor; ao esgotar, volta para a página 1.
  const remote = query({ work_arrangement: "remote", category: REMOTE_CATEGORIES }, readRemotePage(ctx.cursor));
  while (true) {
    const step = await remote.next();
    if (step.done) {
      ctx.setCursor(JSON.stringify({ remotePage: step.value ?? 1 }));
      return;
    }
    yield step.value;
  }
}

export const fourdayweek: Connector = {
  id: "fourdayweek",
  brazilian: false,
  fullSnapshot: false,
  revisitsCatalogWithinHours: REVISITS_CATALOG_WITHIN_HOURS,
  minIntervalMinutes: 60,
  allowedHosts: [FOURDAYWEEK_HOST],
  attribution: { label: "4 Day Week", url: `https://${FOURDAYWEEK_HOST}`, dofollow: false },
  fetch: fetchPages,
  normalize(raw) {
    const parsed = jobSchema.safeParse(raw);
    if (!parsed.success) return null;
    const j = parsed.data;
    const url = safeUrl(j.url);
    if (!url || !j.company) return null;

    const locations = j.locations ?? [];
    const regions = [...new Set(locations.map((l) => l.country ?? l.continent).filter((r): r is string => !!r))];
    const brazil = locations.find((l) => l.country === "Brazil");
    return {
      externalId: j.id,
      url,
      title: j.title,
      company: j.company.name,
      companyLogoUrl: j.company.logo_url ? safeUrl(j.company.logo_url) : null,
      descriptionHtml: j.description ?? "",
      descriptionFormat: "markdown",
      country: brazil ? "BR" : null,
      city: brazil?.city ?? null,
      locationText: regions.length > 0 ? regions.join(", ") : null,
      eligibleRegions: regions,
      workModeHint: WORK_MODE[(j.work_arrangement ?? "").toLowerCase() as keyof typeof WORK_MODE] ?? null,
      seniorityHint: SENIORITY[(j.level ?? "").toLowerCase()] ?? null,
      tags: [...new Set([...(j.skills ?? []), ...(j.stack ?? [])].map((t) => t.name))],
      salary: mapSalary(j),
      publishedAt: toDate(j.posted_at),
    };
  },
};
