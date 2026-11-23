import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { jobicy } from "@/lib/server/sources/jobicy";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { safeUrl } from "@/lib/shared/url";
import { collect, fakeCtx } from "./helpers";

type Feed = { jobs: { id: number | string; jobGeo: string }[] };

const dir = resolve(import.meta.dirname, "../../../fixtures/sources/jobicy");
const brazil = JSON.parse(readFileSync(resolve(dir, "brazil.json"), "utf8")) as Feed;
const latam = JSON.parse(readFileSync(resolve(dir, "latam.json"), "utf8")) as Feed;
const ids = (f: Feed) => f.jobs.map((j) => String(j.id));
const union = [...new Set([...ids(brazil), ...ids(latam)])];

function feedFor(url: URL): Feed | undefined {
  if (url.origin !== "https://jobicy.com" || url.pathname !== "/api/v2/remote-jobs") return undefined;
  if (url.searchParams.get("industry") !== "engineering") return undefined;
  const geo = url.searchParams.get("geo");
  return geo === "brazil" ? brazil : geo === "latam" ? latam : undefined;
}

describe("conector Jobicy", () => {
  it("declara os metadados da D-07 e está registrado", () => {
    expect(jobicy.id).toBe("jobicy");
    expect(jobicy.fullSnapshot).toBe(false);
    expect(jobicy.brazilian).toBe(false);
    expect(jobicy.minIntervalMinutes).toBe(60);
    expect(jobicy.attribution.url).toBe("https://jobicy.com");
    expect(CONNECTORS.jobicy).toBe(jobicy);
  });

  it("coleta e normaliza a fixture (teste comum)", async () => {
    const raws = await collect(jobicy.fetch(fakeCtx({ serve: feedFor })));
    const jobs = raws.map(jobicy.normalize).filter(Boolean);
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j!.externalId).toBeTruthy();
      expect(safeUrl(j!.url, { allowHttp: true })).not.toBeNull();
      expect(j!.title).toBeTruthy();
      expect(j!.url.startsWith("https://jobicy.com/")).toBe(true);
    }
    expect(jobicy.normalize({ lixo: true })).toBeNull();
  });

  it("busca geo=brazil e geo=latam com industry=engineering", async () => {
    const ctx = fakeCtx({ serve: feedFor });
    await collect(jobicy.fetch(ctx));
    const geos = ctx.requests.map((r) => new URL(r.url).searchParams.get("geo")).sort();
    expect(geos).toEqual(["brazil", "latam"]);
    for (const r of ctx.requests) expect(new URL(r.url).searchParams.get("industry")).toBe("engineering");
    expect(ctx.cursors).toEqual([]);
  });

  it("devolve cada id uma única vez quando as duas consultas se sobrepõem", async () => {
    const overlap = ids(brazil).filter((id) => ids(latam).includes(id));
    expect(overlap.length).toBeGreaterThan(0);
    const raws = (await collect(jobicy.fetch(fakeCtx({ serve: feedFor })))) as { id: number | string }[];
    const got = raws.map((r) => String(r.id));
    expect(got).toHaveLength(union.length);
    expect(new Set(got).size).toBe(got.length);
  });

  it("se uma consulta falha, devolve o que a outra trouxe", async () => {
    const onlyLatam = (url: URL) => (url.searchParams.get("geo") === "latam" ? latam : undefined);
    const raws = await collect(jobicy.fetch(fakeCtx({ serve: onlyLatam })));
    expect(raws).toHaveLength(latam.jobs.length);
  });

  it("se as duas consultas falham, lança erro", async () => {
    await expect(collect(jobicy.fetch(fakeCtx({ serve: () => undefined })))).rejects.toThrow();
  });

  it("mapeia id, URL da página do Jobicy, descrição HTML, data e região", async () => {
    const raws = await collect(jobicy.fetch(fakeCtx({ serve: feedFor })));
    const jobs = raws.map(jobicy.normalize).filter((j) => j !== null);
    const first = jobs.find((j) => j.externalId === String(brazil.jobs[0]!.id))!;
    expect(first.descriptionFormat).toBe("html");
    expect(first.descriptionHtml).toContain("<");
    expect(first.publishedAt).toBeInstanceOf(Date);
    expect(first.workModeHint).toBe("remote");
    expect(first.eligibleRegions).toEqual(["EMEA", "LATAM", "Canada", "USA"]);
    const onlyBrazil = jobs.find((j) => j.eligibleRegions.join() === "Brazil")!;
    expect(onlyBrazil.country).toBe("BR");
    const anywhere = jobs.find((j) => j.eligibleRegions.includes("Worldwide"));
    expect(anywhere?.country).toBeNull();
  });

  it("converte salário anual e mensal quando presente", async () => {
    const raws = await collect(jobicy.fetch(fakeCtx({ serve: feedFor })));
    const jobs = raws.map(jobicy.normalize).filter((j) => j !== null);
    const withSalary = jobs.filter((j) => j.salary);
    expect(withSalary.length).toBeGreaterThan(0);
    expect(withSalary.some((j) => j.salary!.period === "year")).toBe(true);
    expect(withSalary.some((j) => j.salary!.period === "month")).toBe(true);
    for (const j of withSalary) expect(j.salary!.currency).toMatch(/^[A-Z]{3}$/);
    expect(jobs.some((j) => j.salary === null)).toBe(true);
  });
});
