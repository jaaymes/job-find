import "server-only";
import { z } from "@/lib/shared/zod";
import { safeUrl } from "@/lib/shared/url";
import { fixMojibake } from "@/lib/server/sources/text";
import { parseLocation } from "@/lib/server/sources/location";
import type { Connector, ConnectorContext, NormalizedJob } from "@/lib/server/sources/types";

/** Host fixo da API (D-07): o fetch seguro só aceita URLs base definidas no código. */
export const REMOTEOK_HOST = "remoteok.com";
const API_URL = `https://${REMOTEOK_HOST}/api`;

const jobSchema = z.object({
  id: z.union([z.string().min(1), z.number()]),
  /** Página da vaga no RemoteOK (a atribuição exige o link para ela). */
  url: z.string().min(1),
  position: z.string().trim().min(1),
  company: z.string().trim().min(1),
  description: z.string().nullish(),
  date: z.string().nullish(),
  location: z.string().nullish(),
  tags: z.array(z.string()).nullish(),
  salary_min: z.number().nullish(),
  salary_max: z.number().nullish(),
});

// --- coleta -----------------------------------------------------------------------------------

/** O item [0] da resposta é o aviso legal (termos da API), não uma vaga. */
async function* fetchApi(ctx: ConnectorContext): AsyncGenerator<unknown> {
  const res = await ctx.fetchJson(API_URL, { signal: ctx.signal });
  if (res.status !== 200) throw new Error(`RemoteOK respondeu ${res.status}`);
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error("RemoteOK: resposta fora do formato esperado");
  yield* body.slice(1);
}

// --- normalização -----------------------------------------------------------------------------

export const remoteok: Connector = {
  id: "remoteok",
  brazilian: false,
  fullSnapshot: true,
  minIntervalMinutes: 60,
  allowedHosts: [REMOTEOK_HOST],
  // Termos da API: link dofollow para a vaga no RemoteOK e citação "Remote OK"; sem o logo deles.
  attribution: { label: "Remote OK", url: `https://${REMOTEOK_HOST}`, dofollow: true },
  fetch: fetchApi,
  normalize(raw): NormalizedJob | null {
    const parsed = jobSchema.safeParse(raw);
    if (!parsed.success) return null;
    const j = parsed.data;
    const url = safeUrl(j.url);
    if (!url || new URL(url).hostname !== REMOTEOK_HOST) return null;

    // Todas as vagas são remotas; `location` ("US Only", "Europe", "Worldwide") restringe quem pode se candidatar.
    const place = j.location?.replace(/\s+only$/i, "").trim() || null;
    const loc = place ? parseLocation(`remote, ${place}`) : null;
    const published = j.date ? new Date(j.date) : null;
    const min = j.salary_min && j.salary_min > 0 ? j.salary_min : null;
    const max = j.salary_max && j.salary_max > 0 ? j.salary_max : null;
    return {
      externalId: String(j.id),
      url,
      title: fixMojibake(j.position),
      company: fixMojibake(j.company),
      // Nunca exibimos o logo do RemoteOK (marca registrada): o campo `company_logo` é ignorado.
      companyLogoUrl: null,
      descriptionHtml: fixMojibake(j.description ?? ""),
      descriptionFormat: "html",
      country: loc?.country ?? null,
      city: null,
      locationText: place,
      eligibleRegions: loc?.regions ?? [],
      workModeHint: "remote",
      seniorityHint: null,
      tags: (j.tags ?? []).map((t) => t.trim()).filter(Boolean),
      salary: min !== null || max !== null ? { min, max, currency: "USD", period: "year" } : null,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
    };
  },
};
