import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ASHBY_BOARDS, ASHBY_HOST, ashby } from "@/lib/server/sources/ashby";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { safeUrl } from "@/lib/shared/url";
import { collect, fakeCtx } from "./helpers";

type Board = { jobs: { id: string; jobUrl: string; publishedAt: string; title: string }[] };

const dir = resolve(import.meta.dirname, "../../../fixtures/sources/ashby");
const read = (name: string) => JSON.parse(readFileSync(resolve(dir, `${name}.json`), "utf8")) as Board;
const fixtures: Record<string, Board> = { nubank: read("nubank"), supabase: read("supabase") };

function boardSlug(url: URL): string | null {
  const m = /^\/posting-api\/job-board\/([^/]+)$/.exec(url.pathname);
  return url.origin === "https://api.ashbyhq.com" && url.searchParams.get("includeCompensation") === "true"
    ? (m?.[1] ?? null)
    : null;
}

/** Só nubank e supabase existem; os demais slugs devolvem 404. */
const serve = (url: URL): unknown => {
  const slug = boardSlug(url);
  return slug ? fixtures[slug] : undefined;
};

const base = { board: "x", id: "1", title: "Dev", jobUrl: "https://jobs.ashbyhq.com/x/1", isListed: true };

describe("conector Ashby", () => {
  it("declara os metadados da D-07 e está registrado", () => {
    expect(ashby.id).toBe("ashby");
    expect(ashby.fullSnapshot).toBe(true);
    expect(ashby.brazilian).toBe(false);
    expect(ashby.minIntervalMinutes).toBe(60);
    expect(ashby.allowedHosts).toEqual([ASHBY_HOST]);
    expect(ashby.attribution.dofollow).toBe(false);
    expect(CONNECTORS.ashby).toBe(ashby);
    // A lista cresceu na D-03 (descoberta de boards): os curados originais continuam nela, sem duplicatas.
    expect(new Set(ASHBY_BOARDS).size).toBe(ASHBY_BOARDS.length);
    expect(ASHBY_BOARDS.length).toBeGreaterThanOrEqual(50);
    expect(ASHBY_BOARDS).toEqual(
      expect.arrayContaining(["nubank", "supabase", "posthog", "linear", "sanity", "replit", "vanta", "plaid", "ramp", "notion", "cohere",]),
    );
  });

  it("coleta e normaliza a fixture (teste comum)", async () => {
    const ctx = fakeCtx({ serve });
    const raws = await collect(ashby.fetch(ctx));
    expect(raws).toHaveLength(fixtures.nubank!.jobs.length + fixtures.supabase!.jobs.length);
    expect(ctx.requests).toHaveLength(ASHBY_BOARDS.length);
    const jobs = raws.map(ashby.normalize).filter(Boolean);
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j!.externalId).toBeTruthy();
      expect(safeUrl(j!.url, { allowHttp: true })).not.toBeNull();
      expect(j!.title).toBeTruthy();
    }
    expect(ashby.normalize({ lixo: true })).toBeNull();
  });

  it("um board com 404 não derruba os demais; se todos falham, lança", async () => {
    const raws = await collect(ashby.fetch(fakeCtx({ serve })));
    expect(raws.length).toBeGreaterThan(0);
    await expect(collect(ashby.fetch(fakeCtx({ serve: () => undefined })))).rejects.toThrow();
  });

  it("externalId único entre boards, url pública, descrição HTML e data publishedAt", async () => {
    const raws = await collect(ashby.fetch(fakeCtx({ serve })));
    const jobs = raws.map(ashby.normalize).filter((j) => j !== null);
    expect(new Set(jobs.map((j) => j.externalId)).size).toBe(jobs.length);
    const first = fixtures.nubank!.jobs[0]!;
    const job = ashby.normalize(raws[0])!;
    expect(job.externalId).toBe(`nubank:${first.id}`);
    expect(job.url).toBe(first.jobUrl);
    expect(job.company).toBe("Nubank");
    expect(job.descriptionFormat).toBe("html");
    expect(job.descriptionHtml).toContain("<");
    expect(job.publishedAt).toEqual(new Date(first.publishedAt));
  });

  it("workplaceType Remote vira workModeHint remote; Hybrid e OnSite também mapeiam", () => {
    expect(ashby.normalize({ ...base, workplaceType: "Remote" })!.workModeHint).toBe("remote");
    expect(ashby.normalize({ ...base, workplaceType: "Hybrid" })!.workModeHint).toBe("hybrid");
    expect(ashby.normalize({ ...base, workplaceType: "OnSite" })!.workModeHint).toBe("onsite");
    expect(ashby.normalize({ ...base, workplaceType: null, isRemote: true })!.workModeHint).toBe("remote");
    expect(ashby.normalize({ ...base, location: "Remote - Brazil" })!.workModeHint).toBe("remote");
    expect(ashby.normalize({ ...base })!.workModeHint).toBeNull();
  });

  it("país estruturado de address tem prioridade sobre o texto da localização", () => {
    const job = ashby.normalize({
      ...base,
      location: "Remote",
      workplaceType: "Remote",
      address: { postalAddress: { addressCountry: "Brazil", addressLocality: "São Paulo" } },
    })!;
    expect(job.country).toBe("BR");
    expect(job.city).toBe("São Paulo");
    expect(job.locationText).toBe("Remote");
    expect(job.eligibleRegions).toContain("Brazil");
    // sem address estruturado, cai no parser de texto
    expect(ashby.normalize({ ...base, location: "Curitiba, Brazil" })!.country).toBe("BR");
  });

  it("salary vem de compensation (Salary, moeda e intervalo conhecidos); senão null", async () => {
    const raws = await collect(ashby.fetch(fakeCtx({ serve })));
    const salaries = raws.map(ashby.normalize).flatMap((j) => (j?.salary ? [j.salary] : []));
    expect(salaries).toContainEqual({ min: 129600, max: 162000, currency: "USD", period: "year" });
    expect(salaries).toContainEqual({ min: 200000, max: 270000, currency: "USD", period: "year" });
    const comp = (c: object) => ashby.normalize({ ...base, compensation: { summaryComponents: [c] } })!.salary;
    expect(comp({ compensationType: "Salary", interval: "1 MONTH", currencyCode: "BRL", minValue: 9000, maxValue: null })).toEqual({
      min: 9000, max: null, currency: "BRL", period: "month",
    });
    expect(comp({ compensationType: "Salary", interval: "1 HOUR", currencyCode: "USD", minValue: 50, maxValue: 70 })!.period).toBe("hour");
    expect(comp({ compensationType: "EquityPercentage", interval: "NONE", currencyCode: null, minValue: null, maxValue: null })).toBeNull();
    expect(comp({ compensationType: "Salary", interval: "1 YEAR", currencyCode: null, minValue: 1, maxValue: 2 })).toBeNull();
    expect(comp({ compensationType: "Salary", interval: "NONE", currencyCode: "USD", minValue: 1, maxValue: 2 })).toBeNull();
    expect(ashby.normalize({ ...base, compensation: null })!.salary).toBeNull();
  });

  it("descarta vaga não listada e url inválida", () => {
    expect(ashby.normalize({ ...base, isListed: false })).toBeNull();
    expect(ashby.normalize({ ...base, jobUrl: "javascript:alert(1)" })).toBeNull();
  });
});
