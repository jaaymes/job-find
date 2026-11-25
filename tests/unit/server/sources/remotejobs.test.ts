import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { REMOTEJOBS_HOST, remotejobs } from "@/lib/server/sources/remotejobs";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { collect, fakeCtx } from "./helpers";

type Raw = Record<string, unknown> & { id: string; company: { name: string }; location_normalization: Record<string, unknown> };
type Page = { data: Raw[]; pagination: Record<string, unknown> };

const dir = resolve(import.meta.dirname, "../../../fixtures/sources/remotejobs");
const page1 = JSON.parse(readFileSync(resolve(dir, "page-1.json"), "utf8")) as Page;
const page2 = JSON.parse(readFileSync(resolve(dir, "page-2.json"), "utf8")) as Page;

function serve(url: URL): unknown {
  if (url.origin !== "https://remotejobs.org" || url.pathname !== "/api/v1/jobs") return undefined;
  const offset = url.searchParams.get("offset");
  return offset === "0" ? page1 : offset === "50" ? page2 : undefined;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** Primeira vaga da fixture com campos da localização sobrescritos. */
function variant(loc: Record<string, unknown>, extra: Record<string, unknown> = {}): Raw {
  const raw = clone(page1.data[0]!);
  raw.location_normalization = { ...raw.location_normalization, ...loc };
  return { ...raw, ...extra };
}

describe("conector RemoteJobs.org", () => {
  it("declara os metadados da spec e está registrado", () => {
    expect(remotejobs).toMatchObject({ id: "remotejobs", fullSnapshot: true, brazilian: false, minIntervalMinutes: 60 });
    expect(remotejobs.allowedHosts).toEqual([REMOTEJOBS_HOST]);
    expect(remotejobs.attribution).toEqual({ label: "RemoteJobs.org", url: "https://remotejobs.org", dofollow: false });
    expect(CONNECTORS.remotejobs).toBe(remotejobs);
  });

  it("pagina com country=BR&sort=recent&limit=50 até has_more=false", async () => {
    const ctx = fakeCtx({ serve });
    await collect(remotejobs.fetch(ctx));
    const params = ctx.requests.map((r) => new URL(r.url).searchParams);
    expect(params.map((p) => p.get("offset"))).toEqual(["0", "50"]);
    for (const p of params) {
      expect(p.get("country")).toBe("BR");
      expect(p.get("sort")).toBe("recent");
      expect(p.get("limit")).toBe("50");
    }
    expect(ctx.partials).toEqual([]);
  });

  it("id repetido entre páginas sai uma vez", async () => {
    const raws = (await collect(remotejobs.fetch(fakeCtx({ serve })))) as { id: string }[];
    expect(raws.length).toBe(7);
    expect(new Set(raws.map((r) => r.id)).size).toBe(7);
  });

  it("teto de 30 páginas com has_more=true reporta parcial", async () => {
    let n = 0;
    const ctx = fakeCtx({
      serve: () => ({ data: [{ id: `job-${n++}` }], pagination: { has_more: true } }),
    });
    await collect(remotejobs.fetch(ctx));
    expect(ctx.requests.length).toBe(30);
    expect(ctx.partials.length).toBe(1);
    expect(ctx.partials[0]!.label).toBe("remotejobs");
  });

  it("prazo da fonte esgotado reporta parcial e para", async () => {
    const ctx = fakeCtx({ serve, deadlineAt: Date.now() - 1 });
    const raws = await collect(remotejobs.fetch(ctx));
    expect(ctx.requests.length).toBe(0);
    expect(raws).toEqual([]);
    expect(ctx.partials.length).toBe(1);
    expect(ctx.partials[0]!.label).toBe("remotejobs");
  });

  it("página vazia com has_more=true reporta parcial e para", async () => {
    const ctx = fakeCtx({ serve: () => ({ data: [], pagination: { has_more: true } }) });
    await collect(remotejobs.fetch(ctx));
    expect(ctx.requests.length).toBe(1);
    expect(ctx.partials.map((p) => p.label)).toEqual(["remotejobs"]);
  });

  it("HTTP diferente de 200 ou JSON fora do formato lança", async () => {
    const failing = fakeCtx({ serve: (u) => (u.searchParams.get("offset") === "50" ? undefined : page1) });
    await expect(collect(remotejobs.fetch(failing))).rejects.toThrow(/RemoteJobs/);
    const garbage = fakeCtx({ serve: (u) => (u.searchParams.get("offset") === "50" ? { lixo: true } : page1) });
    await expect(collect(remotejobs.fetch(garbage))).rejects.toThrow(/RemoteJobs/);
  });

  it("normalize decodifica entidades, usa a URL do remotejobs.org e mapeia campos", () => {
    const jobs = [...page1.data, ...page2.data].map((r) => remotejobs.normalize(r));
    expect(jobs.every(Boolean)).toBe(true);
    for (const j of jobs) {
      expect(j!.url.startsWith("https://remotejobs.org/remote-jobs/")).toBe(true);
      expect(j!.descriptionFormat).toBe("html");
    }
    expect(page1.data[1]!.company.name).toContain("&amp;");
    expect(jobs[1]!.company).toBe("Johnson & Johnson");

    const first = jobs[0]!;
    expect(first.externalId).toBe(page1.data[0]!.id);
    expect(first.publishedAt).toEqual(new Date(page1.data[0]!.posted_at as string));
    expect(first.tags).toContain((page1.data[0]!.category as { name: string }).name);
    expect(first.eligibleRegions).toEqual(["Brazil"]);
    expect(first.seniorityHint).toBe("lead");
    const facts = (seniority: string) => ({ ...(page1.data[0]!.search_facts as object), seniority });
    expect(remotejobs.normalize(variant({}, { search_facts: facts("staff") }))!.seniorityHint).toBe("senior");
    expect(remotejobs.normalize(variant({}, { title: "Dev &amp; Ops" }))!.title).toBe("Dev & Ops");
    expect(jobs[3]!.eligibleRegions).toEqual(["Worldwide"]);

    expect(jobs[2]!.salary).toEqual({ min: 60000, max: 90000, currency: "USD", period: "year" });
    expect(remotejobs.normalize(variant({}, { salary_min: 10, salary_max: 20, salary_currency: "USD", salary_period: "week" }))!.salary).toBeNull();

    const mode = (work_arrangement: string) =>
      remotejobs.normalize(variant({ work_arrangement, worksite_countries: ["BR"] }))!.workModeHint;
    expect(mode("remote")).toBe("remote");
    expect(mode("hybrid")).toBe("hybrid");
    expect(mode("onsite")).toBe("onsite");
    expect(mode("unknown")).toBeNull();
    expect(remotejobs.normalize(variant({ worksite_countries: ["BR"] }))!.country).toBe("BR");
  });

  it("normalize rejeita lixo, host diferente e presencial/híbrida fora do Brasil", () => {
    expect(remotejobs.normalize({ lixo: true })).toBeNull();
    expect(remotejobs.normalize({ ...clone(page1.data[0]!), url: "https://empresa.example/x" })).toBeNull();
    expect(remotejobs.normalize(variant({ work_arrangement: "hybrid", worksite_countries: ["SG"] }))).toBeNull();
    expect(remotejobs.normalize(variant({ work_arrangement: "onsite", worksite_countries: ["SG"] }))).toBeNull();
    expect(remotejobs.normalize(variant({ work_arrangement: "hybrid", worksite_countries: ["BR"] }))).not.toBeNull();
  });
});
