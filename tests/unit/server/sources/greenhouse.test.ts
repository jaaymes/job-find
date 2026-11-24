import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GREENHOUSE_BOARDS, GREENHOUSE_HOST, decodeEntities, greenhouse, parseLocation } from "@/lib/server/sources/greenhouse";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { safeUrl } from "@/lib/shared/url";
import { collect, fakeCtx } from "./helpers";

type Board = { jobs: { id: number; absolute_url: string; location: { name: string } }[] };

const dir = resolve(import.meta.dirname, "../../../fixtures/sources/greenhouse");
const read = (name: string) => JSON.parse(readFileSync(resolve(dir, `${name}.json`), "utf8")) as Board;
const fixtures: Record<string, Board> = { stone: read("stone"), gitlab: read("gitlab") };

function boardSlug(url: URL): string | null {
  const m = /^\/v1\/boards\/([^/]+)\/jobs$/.exec(url.pathname);
  return url.origin === "https://boards-api.greenhouse.io" && url.searchParams.get("content") === "true"
    ? (m?.[1] ?? null)
    : null;
}

/** Só stone e gitlab existem; os demais slugs devolvem 404. */
function serve(url: URL): unknown {
  const slug = boardSlug(url);
  return slug ? fixtures[slug] : undefined;
}

describe("conector Greenhouse", () => {
  it("declara os metadados da D-07 e está registrado", () => {
    expect(greenhouse.id).toBe("greenhouse");
    expect(greenhouse.fullSnapshot).toBe(true);
    expect(greenhouse.attribution.dofollow).toBe(false);
    expect(greenhouse.minIntervalMinutes).toBe(60);
    expect(greenhouse.allowedHosts).toEqual([GREENHOUSE_HOST]);
    // Boards grandes (databricks ~9,7 MB com content=true) passam do padrão de 10 MB do fetch seguro.
    expect(greenhouse.maxResponseBytes).toBe(25 * 1024 * 1024);
    expect(CONNECTORS.greenhouse).toBe(greenhouse);
    // A lista cresceu na D-03 (descoberta de boards): os curados originais continuam nela, sem duplicatas.
    expect(new Set(GREENHOUSE_BOARDS).size).toBe(GREENHOUSE_BOARDS.length);
    expect(GREENHOUSE_BOARDS.length).toBeGreaterThanOrEqual(50);
    expect(GREENHOUSE_BOARDS).toEqual(expect.arrayContaining([
      "stone", "c6bank", "btgpactual", "xpinc", "inter", "quintoandar", "gympass", "clara", "ebanx", "vtex",
      "jusbrasil", "wildlifestudios", "getnet", "gitlab", "canonical", "twilio", "datadog", "stripe", "databricks",
    ]));
  });

  it("coleta e normaliza a fixture (teste comum)", async () => {
    const raws = await collect(greenhouse.fetch(fakeCtx({ serve })));
    const total = fixtures.stone!.jobs.length + fixtures.gitlab!.jobs.length;
    expect(raws).toHaveLength(total);
    const jobs = raws.map(greenhouse.normalize).filter(Boolean);
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j!.externalId).toBeTruthy();
      expect(safeUrl(j!.url, { allowHttp: true })).not.toBeNull();
      expect(j!.title).toBeTruthy();
    }
    expect(greenhouse.normalize({ lixo: true })).toBeNull();
  });

  it("consulta cada slug com content=true e concorrência de no máximo 5", async () => {
    let active = 0;
    let peak = 0;
    const ctx = fakeCtx({ serve });
    const inner = ctx.fetchJson;
    ctx.fetchJson = async (url, init) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      try {
        return await inner(url, init);
      } finally {
        active--;
      }
    };
    await collect(greenhouse.fetch(ctx));
    expect(ctx.requests.map((r) => boardSlug(new URL(r.url))).sort()).toEqual([...GREENHOUSE_BOARDS].sort());
    expect(peak).toBe(5);
  });

  it("um slug com 404 não derruba os demais", async () => {
    const ctx = fakeCtx({ serve });
    const raws = await collect(greenhouse.fetch(ctx));
    expect(ctx.requests).toHaveLength(GREENHOUSE_BOARDS.length);
    expect(raws.length).toBeGreaterThan(0);
  });

  it("slug que lança erro também é ignorado", async () => {
    const ctx = fakeCtx({ serve });
    const inner = ctx.fetchJson;
    ctx.fetchJson = async (url, init) => {
      if (boardSlug(new URL(url)) === "stone") throw new Error("falha de rede");
      return inner(url, init);
    };
    const raws = await collect(greenhouse.fetch(ctx));
    expect(raws).toHaveLength(fixtures.gitlab!.jobs.length);
  });

  it("se todos os slugs falham, a coleta lança erro", async () => {
    await expect(collect(greenhouse.fetch(fakeCtx({ serve: () => undefined })))).rejects.toThrow();
  });

  it("externalId é único entre boards, url é absolute_url e a data vem de first_published", async () => {
    const raws = await collect(greenhouse.fetch(fakeCtx({ serve })));
    const jobs = raws.map(greenhouse.normalize).filter((j) => j !== null);
    expect(new Set(jobs.map((j) => j.externalId)).size).toBe(jobs.length);
    const first = fixtures.stone!.jobs[0]!;
    const job = greenhouse.normalize(raws[0])!;
    expect(job.externalId).toBe(`stone:${first.id}`);
    expect(job.url).toBe(first.absolute_url);
    expect(job.company).toBe("Stone - Linkedin");
    expect(job.publishedAt).toEqual(new Date("2026-11-12T06:02:23-05:00"));
    expect(job.country).toBe("BR");
    expect(job.city).toBe("Sao Paulo");
  });

  it("usa updated_at quando não há first_published e o slug como empresa sem company_name", () => {
    const job = greenhouse.normalize({
      board: "ebanx",
      id: 1,
      title: "Dev",
      absolute_url: "https://job-boards.greenhouse.io/ebanx/jobs/1",
      updated_at: "2026-01-02T03:04:05Z",
      first_published: null,
      location: { name: "Curitiba, Brazil" },
      content: "",
    });
    expect(job!.publishedAt).toEqual(new Date("2026-01-02T03:04:05Z"));
    expect(job!.company).toBe("Ebanx");
  });

  it("decodifica o HTML escapado do content", async () => {
    const raws = await collect(greenhouse.fetch(fakeCtx({ serve })));
    const job = greenhouse.normalize(raws[0])!;
    expect(job.descriptionFormat).toBe("html");
    expect(job.descriptionHtml).toContain("<div class=\"content-intro\">");
    expect(job.descriptionHtml).not.toContain("&lt;");
    expect(decodeEntities("&lt;p&gt;a &amp;amp; b&lt;/p&gt; &quot;x&quot; &#39;y&#39; &#x41; &nbsp;")).toBe(
      "<p>a &amp; b</p> \"x\" 'y' A  ",
    );
  });

  it("descarta url inválida", () => {
    expect(
      greenhouse.normalize({ board: "x", id: 1, title: "T", absolute_url: "javascript:alert(1)", location: { name: "" } }),
    ).toBeNull();
  });
});

describe("parseLocation (Greenhouse location.name)", () => {
  const cases: [string, ReturnType<typeof parseLocation>][] = [
    ["Remote", { country: null, city: null, workMode: "remote", regions: [] }],
    ["Remote - Brazil", { country: "BR", city: null, workMode: "remote", regions: ["Brazil"] }],
    ["Remote, United States", { country: "US", city: null, workMode: "remote", regions: ["United States"] }],
    ["Remote Ireland", { country: "IE", city: null, workMode: "remote", regions: ["Ireland"] }],
    ["São Paulo, Brazil", { country: "BR", city: "São Paulo", workMode: null, regions: [] }],
    ["Sao Paulo, Sao Paulo, Brasil", { country: "BR", city: "Sao Paulo", workMode: null, regions: [] }],
    ["New York, NY", { country: "US", city: "New York", workMode: null, regions: [] }],
    ["Hybrid - London", { country: null, city: "London", workMode: "hybrid", regions: [] }],
    ["Remote, North America", { country: null, city: null, workMode: "remote", regions: ["North America"] }],
    ["Remote, Canada; Remote, United States", { country: null, city: null, workMode: "remote", regions: ["Canada", "United States"] }],
    ["Remote, Latin America", { country: null, city: null, workMode: "remote", regions: ["Latin America"] }],
    ["", { country: null, city: null, workMode: null, regions: [] }],
  ];
  it.each(cases)("%s", (input, expected) => {
    expect(parseLocation(input)).toEqual(expected);
  });
});
