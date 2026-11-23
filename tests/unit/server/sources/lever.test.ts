import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LEVER_BOARDS, lever } from "@/lib/server/sources/lever";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { safeUrl } from "@/lib/shared/url";
import { collect, fakeCtx } from "./helpers";

type Posting = { id: string; hostedUrl: string; createdAt: number; text: string };

const dir = resolve(import.meta.dirname, "../../../fixtures/sources/lever");
const read = (name: string) => JSON.parse(readFileSync(resolve(dir, `${name}.json`), "utf8")) as Posting[];
const fixtures: Record<string, Posting[]> = { neon: read("neon"), spotify: read("spotify") };

function boardSlug(url: URL): string | null {
  const m = /^\/v0\/postings\/([^/]+)$/.exec(url.pathname);
  return url.origin === "https://api.lever.co" && url.searchParams.get("mode") === "json" ? (m?.[1] ?? null) : null;
}

/** Só neon e spotify existem; os demais slugs devolvem 404. */
const serve = (url: URL): unknown => {
  const slug = boardSlug(url);
  return slug ? fixtures[slug] : undefined;
};

const base = { board: "x", id: "1", text: "Dev", hostedUrl: "https://jobs.lever.co/x/1", createdAt: 1_700_000_000_000 };

describe("conector Lever", () => {
  it("declara os metadados da D-07 e está registrado", () => {
    expect(lever.id).toBe("lever");
    expect(lever.fullSnapshot).toBe(true);
    expect(lever.brazilian).toBe(false);
    expect(lever.minIntervalMinutes).toBe(60);
    expect(lever.attribution.dofollow).toBe(false);
    expect(CONNECTORS.lever).toBe(lever);
    expect(LEVER_BOARDS).toEqual(["ciandt", "neon", "swile", "toptal", "spotify"]);
  });

  it("coleta e normaliza a fixture (teste comum)", async () => {
    const ctx = fakeCtx({ serve });
    const raws = await collect(lever.fetch(ctx));
    expect(raws).toHaveLength(fixtures.neon!.length + fixtures.spotify!.length);
    expect(ctx.requests).toHaveLength(LEVER_BOARDS.length);
    const jobs = raws.map(lever.normalize).filter(Boolean);
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j!.externalId).toBeTruthy();
      expect(safeUrl(j!.url, { allowHttp: true })).not.toBeNull();
      expect(j!.title).toBeTruthy();
    }
    expect(lever.normalize({ lixo: true })).toBeNull();
  });

  it("um board com 404 não derruba os demais; se todos falham, lança", async () => {
    expect((await collect(lever.fetch(fakeCtx({ serve })))).length).toBeGreaterThan(0);
    await expect(collect(lever.fetch(fakeCtx({ serve: () => undefined })))).rejects.toThrow();
  });

  it("externalId único entre boards, url = hostedUrl e publishedAt vem de createdAt em ms", async () => {
    const raws = await collect(lever.fetch(fakeCtx({ serve })));
    const jobs = raws.map(lever.normalize).filter((j) => j !== null);
    expect(new Set(jobs.map((j) => j.externalId)).size).toBe(jobs.length);
    const first = fixtures.neon!.find((p) => p.id === "734be933-af35-44f1-9f01-9dd623312117")!;
    const job = jobs.find((j) => j.externalId === `neon:${first.id}`)!;
    expect(job.url).toBe(first.hostedUrl);
    expect(job.title).toBe(first.text);
    expect(job.company).toBe("Neon");
    expect(job.publishedAt).toEqual(new Date(first.createdAt));
    expect(job.publishedAt!.getFullYear()).toBe(2026);
  });

  it("workplaceType remote vira workModeHint remote; país ISO estruturado vira country", async () => {
    const raws = await collect(lever.fetch(fakeCtx({ serve })));
    const neon = raws
      .map(lever.normalize)
      .find((j) => j?.externalId === "neon:734be933-af35-44f1-9f01-9dd623312117")!;
    expect(neon.workModeHint).toBe("remote");
    expect(neon.country).toBe("BR");
    expect(neon.eligibleRegions).toContain("Brazil");
    expect(lever.normalize({ ...base, workplaceType: "hybrid" })!.workModeHint).toBe("hybrid");
    expect(lever.normalize({ ...base, workplaceType: "onsite" })!.workModeHint).toBe("onsite");
    expect(lever.normalize({ ...base, workplaceType: "unspecified" })!.workModeHint).toBeNull();
    expect(lever.normalize({ ...base, categories: { location: "Remote - Brazil" } })!.workModeHint).toBe("remote");
    expect(lever.normalize({ ...base, country: "us", categories: { location: "New York, NY" } })!.country).toBe("US");
    expect(lever.normalize({ ...base, country: "XYZ", categories: { location: "Curitiba, Brazil" } })!.country).toBe("BR");
  });

  it("compõe a descrição HTML com description, lists e additional", async () => {
    const raws = await collect(lever.fetch(fakeCtx({ serve })));
    const job = raws.map(lever.normalize).find((j) => j?.externalId === "neon:734be933-af35-44f1-9f01-9dd623312117")!;
    expect(job.descriptionFormat).toBe("html");
    expect(job.descriptionHtml).toContain("Sobre a Neon");
    expect(job.descriptionHtml).toContain("<h3>Responsabilidades</h3><ul>");
    expect(job.descriptionHtml).toContain("Se vier fazer parte da Neon");
    const composed = lever.normalize({
      ...base,
      description: "<div>d</div>",
      lists: [{ text: "A & B", content: "<li>x</li>" }],
      additional: "<div>z</div>",
    })!;
    expect(composed.descriptionHtml).toBe("<div>d</div><h3>A &amp; B</h3><ul><li>x</li></ul><div>z</div>");
  });

  it("salary vem de salaryRange; intervalo vira hour/month/year; sem moeda ou período, null", async () => {
    const raws = await collect(lever.fetch(fakeCtx({ serve })));
    const salaries = raws.map(lever.normalize).flatMap((j) => (j?.salary ? [j.salary] : []));
    expect(salaries).toEqual([{ min: 75645, max: 94556, currency: "USD", period: "year" }]);
    const range = (r: object) => lever.normalize({ ...base, salaryRange: r })!.salary;
    expect(range({ min: 7000, max: 10000, currency: "SGD", interval: "per-month-salary" })).toEqual({
      min: 7000, max: 10000, currency: "SGD", period: "month",
    });
    expect(range({ min: 50, max: 80, currency: "USD", interval: "per-hour-wage" })!.period).toBe("hour");
    expect(range({ min: 1, max: 2, interval: "per-year-salary" })).toBeNull();
    expect(range({ min: 1, max: 2, currency: "USD" })).toBeNull();
    expect(range({ min: 1, max: 2, currency: "USD", interval: "one-time" })).toBeNull();
    expect(range({ currency: "USD", interval: "per-year-salary" })).toBeNull();
    expect(lever.normalize({ ...base })!.salary).toBeNull();
  });

  it("descarta url inválida", () => {
    expect(lever.normalize({ ...base, hostedUrl: "javascript:alert(1)" })).toBeNull();
  });
});
