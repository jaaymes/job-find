import "server-only";
import { z } from "@/lib/shared/zod";
import { safeUrl } from "@/lib/shared/url";
import { decodeEntities } from "@/lib/server/sources/text";
import { countryCodeFromName } from "@/lib/server/sources/location";
import { UNKNOWN_COMPANY, type Connector, type ConnectorContext, type NormalizedJob } from "@/lib/server/sources/types";

/** Host fixo do feed (D-07): o fetch seguro só aceita URLs base definidas no código. */
export const WWR_HOST = "weworkremotely.com";

/** Feeds RSS das categorias tech (cada um traz as vagas mais recentes da categoria). */
export const WWR_CATEGORY_FEEDS = ["remote-programming-jobs.rss", "remote-devops-sysadmin-jobs.rss"] as const;

const FIELDS = ["title", "region", "category", "description", "pubDate", "guid", "link"] as const;

export const itemSchema = z.object({
  title: z.string().trim().min(1),
  link: z.string().min(1),
  region: z.string().nullish(),
  category: z.string().nullish(),
  description: z.string().nullish(),
  pubDate: z.string().nullish(),
  guid: z.string().nullish(),
});

// --- RSS (sem dependência de XML: o feed é plano, um nível de campos por <item>) -------------------

const CDATA = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/;

/** Valor de texto de um campo: CDATA vale como está; fora dele, as entidades XML são decodificadas. */
function fieldValue(inner: string): string {
  const cdata = CDATA.exec(inner);
  return (cdata ? cdata[1]! : decodeEntities(inner)).trim();
}

/** Extrai os campos conhecidos de cada `<item>` do RSS; sem itens (ou HTML no lugar do feed), devolve `[]`. */
export function parseRssItems(xml: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  for (const block of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item: Record<string, string> = {};
    for (const field of FIELDS) {
      const m = new RegExp(`<${field}>([\\s\\S]*?)</${field}>`).exec(block[1]!);
      if (m) item[field] = fieldValue(m[1]!);
    }
    items.push(item);
  }
  return items;
}

// --- coleta -----------------------------------------------------------------------------------

async function* fetchFeeds(ctx: ConnectorContext): AsyncGenerator<unknown> {
  const seen = new Set<string>();
  let failures = 0;
  for (const feed of WWR_CATEGORY_FEEDS) {
    ctx.signal.throwIfAborted();
    try {
      const res = await ctx.fetchText(`https://${WWR_HOST}/categories/${feed}`, { signal: ctx.signal });
      if (res.status !== 200) throw new Error(`We Work Remotely ${feed} respondeu ${res.status}`);
      const items = parseRssItems(await res.text());
      if (items.length === 0) throw new Error(`We Work Remotely ${feed}: feed sem itens`);
      for (const item of items) {
        const key = item.guid ?? item.link;
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        yield item;
      }
    } catch (error) {
      if (ctx.signal.aborted) throw ctx.signal.reason ?? error;
      failures++;
      ctx.reportPartial(feed, error);
    }
  }
  if (failures === WWR_CATEGORY_FEEDS.length) throw new Error("We Work Remotely: todos os feeds falharam");
}

// --- normalização -----------------------------------------------------------------------------

/** "Anywhere in the World" vira "Worldwide"; "USA Only" vira "USA". */
function mapRegion(region: string): string {
  if (/^anywhere\b/i.test(region)) return "Worldwide";
  return region.replace(/\s+only$/i, "").trim();
}

export const wwr: Connector = {
  id: "wwr",
  brazilian: false,
  fullSnapshot: true,
  minIntervalMinutes: 60,
  allowedHosts: [WWR_HOST],
  // Atribuição "via We Work Remotely" com link (a interface acrescenta o "via").
  attribution: { label: "We Work Remotely", url: `https://${WWR_HOST}`, dofollow: false },
  fetch: fetchFeeds,
  normalize(raw): NormalizedJob | null {
    const parsed = itemSchema.safeParse(raw);
    if (!parsed.success) return null;
    const j = parsed.data;
    const url = safeUrl(j.link);
    if (!url || new URL(url).hostname !== WWR_HOST) return null;

    // O título vem como "Empresa: Cargo".
    const sep = j.title.indexOf(": ");
    const company = sep > 0 ? j.title.slice(0, sep).trim() : "";
    const title = (sep > 0 ? j.title.slice(sep + 2) : j.title).trim();
    if (!title) return null;

    const region = j.region?.trim() ? mapRegion(j.region) : null;
    const published = j.pubDate ? new Date(j.pubDate) : null;
    const slug = new URL(url).pathname.split("/").filter(Boolean).pop();
    return {
      externalId: slug ?? url,
      url,
      title,
      company: company || UNKNOWN_COMPANY,
      companyLogoUrl: null,
      descriptionHtml: j.description ?? "",
      descriptionFormat: "html",
      country: region ? countryCodeFromName(region) : null,
      city: null,
      locationText: region,
      eligibleRegions: region ? [region === "USA" ? "United States" : region] : [],
      workModeHint: "remote",
      seniorityHint: null,
      tags: j.category?.trim() ? [j.category.trim()] : [],
      salary: null,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
    };
  },
};
