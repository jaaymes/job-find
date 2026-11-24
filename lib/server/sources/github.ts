import "server-only";
import { z } from "@/lib/shared/zod";
import { safeUrl } from "@/lib/shared/url";
import type { Seniority } from "@/lib/shared/types/job";
import { normalizeText } from "@/lib/server/enrich/text";
import { fetchBoardsPooled } from "@/lib/server/sources/boards";
import { parseLocation } from "@/lib/server/sources/location";
import { UNKNOWN_COMPANY, type Connector, type ConnectorContext, type NormalizedJob } from "@/lib/server/sources/types";

/** Host fixo da API (D-07): o fetch seguro só aceita URLs base definidas no código. */
export const GITHUB_HOST = "api.github.com";

/** Repositórios de vagas curados da D-07 (nada além desta lista é consultado). */
export const GITHUB_REPOS = [
  "frontendbr/vagas", "backend-br/vagas", "react-brasil/vagas", "qa-brasil/vagas", "androiddevbr/vagas",
] as const;

const PAGE_SIZE = 100;
/** Teto de páginas por repositório: 500 issues abertas é bem mais que o volume real (dezenas). */
const MAX_PAGES = 5;

export const issueSchema = z.object({
  /** Repositório `dono/nome`, acrescentado pelo conector ao devolver cada issue. */
  repo: z.string().min(1),
  number: z.number().int(),
  title: z.string().trim().min(1),
  html_url: z.string().min(1),
  body: z.string().nullish(),
  created_at: z.string().nullish(),
  labels: z.array(z.object({ name: z.string() })).nullish(),
  pull_request: z.unknown().optional(),
});

const SENIORITY: [RegExp, Seniority][] = [
  [/^(estagio|estagiari[oa])$/, "intern"],
  [/^junior$/, "junior"],
  [/^pleno$/, "mid"],
  [/^senior$/, "senior"],
  [/^(especialista|lead|tech lead)$/, "lead"],
];

// --- coleta -----------------------------------------------------------------------------------

async function fetchRepo(ctx: ConnectorContext, repo: string): Promise<unknown[]> {
  // O token é opcional (sobe o limite de 60 para 5.000 req/h) e nunca é registrado em log.
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const issues: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(`https://${GITHUB_HOST}/repos/${repo}/issues`);
    url.searchParams.set("state", "open");
    url.searchParams.set("per_page", String(PAGE_SIZE));
    url.searchParams.set("page", String(page));
    const res = await ctx.fetchJson(url.toString(), { headers, signal: ctx.signal });
    if (res.status !== 200) throw new Error(`GitHub ${repo} respondeu ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body)) throw new Error(`GitHub ${repo}: resposta fora do formato esperado`);
    for (const item of body) {
      if (typeof item !== "object" || item === null) continue;
      // A API de issues também lista pull requests.
      if ("pull_request" in item) continue;
      issues.push({ ...(item as Record<string, unknown>), repo });
    }
    if (body.length < PAGE_SIZE) break;
  }
  return issues;
}

function fetchRepos(ctx: ConnectorContext): AsyncGenerator<unknown> {
  return fetchBoardsPooled(ctx, "GitHub", GITHUB_REPOS, (repo) => fetchRepo(ctx, repo));
}

// --- normalização -----------------------------------------------------------------------------

const TITLE_PREFIX = /^\s*\[([^\]]*)\]\s*/;
/** Sufixo de regime de contratação ("| PJ", "| CLT") que não faz parte da empresa. */
const CONTRACT_SUFFIX = /\s*\|\s*(?:pj|clt|pj\s*\/\s*clt|clt\s*\/\s*pj)\s*$/i;
/** "… na Empresa", "… at Empresa", "… @ Empresa": a empresa vem no fim; o `(.*)` guloso pega o último separador. */
const COMPANY_PREP = /^(.*\S)\s+(?:na|no|at|@)\s+([^()]+?)\s*$/i;
/** Sem preposição, "Cargo - Empresa": vale o último " - " (o cargo pode ter outros). */
const COMPANY_DASH = /^(.*\S)\s+[-–—]\s+([^()]+?)\s*$/;

function splitTitle(raw: string): { place: string | null; title: string; company: string | null } {
  let rest = raw.trim();
  let place: string | null = null;
  for (let tag = TITLE_PREFIX.exec(rest); tag; tag = TITLE_PREFIX.exec(rest)) {
    place ??= tag[1]?.trim() || null;
    rest = rest.slice(tag[0].length);
  }
  rest = rest.replace(CONTRACT_SUFFIX, "").trim();
  const m = COMPANY_PREP.exec(rest) ?? COMPANY_DASH.exec(rest);
  return { place, title: (m ? m[1]! : rest).trim() || rest, company: m?.[2]?.trim() || null };
}

export const github: Connector = {
  id: "github",
  brazilian: true,
  fullSnapshot: true,
  minIntervalMinutes: 60,
  allowedHosts: [GITHUB_HOST],
  attribution: { label: "GitHub", url: "https://github.com", dofollow: false },
  fetch: fetchRepos,
  normalize(raw): NormalizedJob | null {
    const parsed = issueSchema.safeParse(raw);
    if (!parsed.success) return null;
    const i = parsed.data;
    if (i.pull_request !== undefined) return null;
    const url = safeUrl(i.html_url);
    if (!url || new URL(url).hostname !== "github.com") return null;

    const { place, title, company } = splitTitle(i.title);
    const loc = place ? parseLocation(place) : null;
    const labels = (i.labels ?? []).map((l) => l.name.trim()).filter(Boolean);
    const created = i.created_at ? new Date(i.created_at) : null;
    return {
      externalId: `${i.repo}#${i.number}`,
      url,
      title,
      company: company ?? UNKNOWN_COMPANY,
      companyLogoUrl: null,
      descriptionHtml: i.body ?? "",
      descriptionFormat: "markdown",
      country: loc?.country ?? null,
      city: loc?.city ?? null,
      locationText: place,
      eligibleRegions: loc?.regions ?? [],
      workModeHint: loc?.workMode ?? null,
      seniorityHint: SENIORITY.find(([re]) => labels.some((l) => re.test(normalizeText(l))))?.[1] ?? null,
      tags: labels,
      salary: null,
      publishedAt: created && !Number.isNaN(created.getTime()) ? created : null,
    };
  },
};
