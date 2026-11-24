import "server-only";
import { z } from "@/lib/shared/zod";
import { htmlToText } from "@/lib/server/sanitize";
import { parseLocation } from "@/lib/server/sources/location";
import type { Connector, ConnectorContext, NormalizedJob } from "@/lib/server/sources/types";

/** Host fixo da API (D-07): o fetch seguro só aceita URLs base definidas no código. */
export const HN_HOST = "hn.algolia.com";
const API = `https://${HN_HOST}/api/v1`;
const ITEM_URL = "https://news.ycombinator.com/item?id=";

const searchSchema = z.object({
  hits: z.array(z.object({ objectID: z.string().min(1), title: z.string().nullish(), created_at: z.string().nullish() })),
});
const threadSchema = z.object({ children: z.array(z.unknown()) });

export const commentSchema = z.object({
  id: z.union([z.string().min(1), z.number()]),
  text: z.string().min(1),
  created_at: z.string().nullish(),
});

// --- coleta -----------------------------------------------------------------------------------

/** Acha a thread "Ask HN: Who is hiring?" mais recente do usuário `whoishiring` (não confundir com "Who wants to be hired?"). */
async function latestHiringThread(ctx: ConnectorContext): Promise<string> {
  const url = new URL(`${API}/search_by_date`);
  url.searchParams.set("tags", "story,author_whoishiring");
  url.searchParams.set("hitsPerPage", "10");
  const res = await ctx.fetchJson(url.toString(), { signal: ctx.signal });
  if (res.status !== 200) throw new Error(`HN (busca da thread) respondeu ${res.status}`);
  const parsed = searchSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error("HN: busca da thread fora do formato esperado");
  const hit = parsed.data.hits.find((h) => /^ask hn: who is hiring\?/i.test(h.title ?? ""));
  if (!hit) throw new Error("HN: thread 'Who is hiring?' não encontrada");
  return hit.objectID;
}

/** Só os comentários de topo da thread (cada um é uma vaga); respostas não entram. */
async function* fetchThread(ctx: ConnectorContext): AsyncGenerator<unknown> {
  const threadId = await latestHiringThread(ctx);
  ctx.signal.throwIfAborted();
  const res = await ctx.fetchJson(`${API}/items/${threadId}`, { signal: ctx.signal });
  if (res.status !== 200) throw new Error(`HN (thread ${threadId}) respondeu ${res.status}`);
  const parsed = threadSchema.safeParse(await res.json());
  if (!parsed.success) throw new Error(`HN: thread ${threadId} fora do formato esperado`);
  yield* parsed.data.children;
}

// --- parser heurístico "Empresa | Cargo | Local | Remote | Salário" ---------------------------------

const MAX_COMPANY_LENGTH = 80;
const ROLE =
  /\b(engineers?|engineering|developers?|designers?|architects?|scientists?|analysts?|managers?|directors?|leads?|head|cto|ciso|founders?|sre|devops|administrators?|researchers?|specialists?|programmers?|consultants?|interns?|product|positions?|roles?|openings?|staff|technicians?|recruiters?|sales|writers?|support|swe)\b/i;
/** Segmentos que não são local nem cargo: contrato, benefícios, salário, links. */
const NOISE =
  /^(?:full[- ]?time|part[- ]?time|contract(?:or)?|freelance|visa|relocation|equity|hiring\b|seed\b|series\b|salary|https?:|www\.)|[$€£]|\b\d+(?:[.,]\d+)?\s?k\b|\d{2,3}[.,]\d{3}|\b[a-z0-9-]+\.(?:com|io|ai|dev|co|org|net|app)\b/i;

export type HnParsed = { company: string; title: string; locationSegments: string[]; workMode: NormalizedJob["workModeHint"] };

/** `null` quando a primeira linha não segue o formato com pipes ou não traz empresa e cargo. */
export function parseHeader(html: string): HnParsed | null {
  const header = htmlToText(html.split(/<p>/i)[0] ?? "");
  const segments = header.split("|").map((s) => s.trim()).filter(Boolean);
  if (segments.length < 3) return null;
  const company = segments[0]!;
  if (company.length > MAX_COMPANY_LENGTH || /^https?:/i.test(company)) return null;

  const rest = segments.slice(1);
  const title = rest.find((s) => ROLE.test(s) && !NOISE.test(s));
  if (!title) return null;
  const locationSegments = rest.filter((s) => s !== title && !NOISE.test(s) && s.length <= 120);
  const workMode = parseLocation(rest.join(";")).workMode;
  return { company, title, locationSegments, workMode };
}

export const hn: Connector = {
  id: "hn",
  brazilian: false,
  // Incremental: a thread só cresce durante o mês; a ausência de um comentário não expira a vaga (vale só a regra dos 45 dias).
  fullSnapshot: false,
  // A thread muda devagar (um novo post por mês, comentários ao longo dos dias).
  minIntervalMinutes: 360,
  allowedHosts: [HN_HOST],
  attribution: { label: "Hacker News", url: "https://news.ycombinator.com", dofollow: false },
  fetch: fetchThread,
  normalize(raw): NormalizedJob | null {
    const parsed = commentSchema.safeParse(raw);
    if (!parsed.success) return null;
    const c = parsed.data;
    const head = parseHeader(c.text);
    if (!head) return null;

    // Segmentos que são só o modelo de trabalho ("REMOTE", "ONSITE") não contam como lugar: sem eles, "New York, NY | ONSITE" dá cidade e país.
    const places = head.locationSegments.filter((s) => !/^(?:remote|hybrid|on-?site)$/i.test(s));
    const loc = parseLocation(places.join(";"));
    const published = c.created_at ? new Date(c.created_at) : null;
    return {
      externalId: String(c.id),
      url: `${ITEM_URL}${c.id}`,
      title: head.title,
      company: head.company,
      companyLogoUrl: null,
      descriptionHtml: c.text,
      descriptionFormat: "html",
      country: loc.country,
      city: loc.city,
      locationText: head.locationSegments.join(" | ") || null,
      eligibleRegions: loc.regions,
      workModeHint: head.workMode,
      seniorityHint: null,
      tags: [],
      salary: null,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
    };
  },
};
