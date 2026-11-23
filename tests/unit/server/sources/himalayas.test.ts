import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { himalayas } from "@/lib/server/sources/himalayas";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { safeUrl } from "@/lib/shared/url";
import { collect, fakeCtx } from "./helpers";

type Page = { nextCursor: string | null; jobs: { guid: string; locationRestrictions: string[] }[] };

const dir = resolve(import.meta.dirname, "../../../fixtures/sources/himalayas");
const page1 = JSON.parse(readFileSync(resolve(dir, "page-1.json"), "utf8")) as Page;
const page2 = JSON.parse(readFileSync(resolve(dir, "page-2.json"), "utf8")) as Page;
const allJobs = [...page1.jobs, ...page2.jobs];

/** Serve a fixture como a API real: sem `cursor` → página 1; `cursor` da página 1 → página 2. */
function serve(url: URL): unknown {
  if (url.origin !== "https://himalayas.app" || url.pathname !== "/jobs/api") return undefined;
  const cursor = url.searchParams.get("cursor");
  if (cursor === null) return page1;
  if (cursor === page1.nextCursor) return page2;
  return undefined;
}

afterEach(() => vi.unstubAllEnvs());

describe("conector Himalayas", () => {
  it("declara os metadados da D-07 e está registrado", () => {
    expect(himalayas.id).toBe("himalayas");
    expect(himalayas.fullSnapshot).toBe(false);
    expect(himalayas.brazilian).toBe(false);
    expect(himalayas.minIntervalMinutes).toBe(60);
    expect(himalayas.attribution).toEqual({ label: "Himalayas", url: "https://himalayas.app", dofollow: false });
    expect(CONNECTORS.himalayas).toBe(himalayas);
  });

  it("coleta e normaliza a fixture (teste comum)", async () => {
    const raws = await collect(himalayas.fetch(fakeCtx({ serve })));
    expect(raws).toHaveLength(allJobs.length);
    const jobs = raws.map(himalayas.normalize).filter(Boolean);
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j!.externalId).toBeTruthy();
      expect(safeUrl(j!.url, { allowHttp: true })).not.toBeNull();
      expect(j!.title).toBeTruthy();
    }
    expect(himalayas.normalize({ lixo: true })).toBeNull();
  });

  it("sem cursor traz todos os itens e grava o guid mais novo uma única vez", async () => {
    const ctx = fakeCtx({ serve });
    const raws = (await collect(himalayas.fetch(ctx))) as { guid: string }[];
    expect(raws.map((r) => r.guid)).toEqual(allJobs.map((j) => j.guid));
    expect(ctx.requests).toHaveLength(2);
    expect(ctx.cursors).toEqual([allJobs[0]!.guid]);
  });

  it("com cursor para no guid salvo (exclusivo) e só devolve as vagas mais novas", async () => {
    const ctx = fakeCtx({ serve, cursor: allJobs[3]!.guid });
    const raws = (await collect(himalayas.fetch(ctx))) as { guid: string }[];
    expect(raws.map((r) => r.guid)).toEqual(allJobs.slice(0, 3).map((j) => j.guid));
    expect(ctx.requests).toHaveLength(1);
    expect(ctx.cursors).toEqual([allJobs[0]!.guid]);
  });

  it("cursor igual ao item mais novo não devolve nada nem regrava o cursor", async () => {
    const ctx = fakeCtx({ serve, cursor: allJobs[0]!.guid });
    expect(await collect(himalayas.fetch(ctx))).toEqual([]);
    expect(ctx.cursors).toEqual([]);
  });

  it("envia Authorization Bearer só quando HIMALAYAS_API_KEY existe", async () => {
    vi.stubEnv("HIMALAYAS_API_KEY", "chave-de-teste");
    const withKey = fakeCtx({ serve });
    await collect(himalayas.fetch(withKey));
    expect(withKey.requests[0]!.headers.Authorization).toBe("Bearer chave-de-teste");

    vi.stubEnv("HIMALAYAS_API_KEY", "");
    const without = fakeCtx({ serve });
    await collect(himalayas.fetch(without));
    expect(without.requests[0]!.headers).not.toHaveProperty("Authorization");
  });

  it("locationRestrictions com Brazil vira eligibleRegions contendo 'Brazil'", () => {
    const raw = allJobs.find((j) => j.locationRestrictions.includes("Brazil"));
    expect(raw).toBeDefined();
    const job = himalayas.normalize(raw);
    expect(job).not.toBeNull();
    expect(job!.eligibleRegions).toContain("Brazil");
    expect(job!.workModeHint).toBe("remote");
    expect(job!.descriptionFormat).toBe("html");
    expect(job!.publishedAt).toBeInstanceOf(Date);
  });

  it("mapeia salário anual e mantém o applicationLink intacto", () => {
    const raw = page1.jobs[0] as unknown as { applicationLink: string };
    const job = himalayas.normalize(raw);
    expect(job!.url).toBe(raw.applicationLink);
    expect(job!.salary).toEqual({ min: 75000, max: 75000, currency: "EUR", period: "year" });
  });
});
