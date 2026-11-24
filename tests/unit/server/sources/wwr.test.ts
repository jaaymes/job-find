import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WWR_CATEGORY_FEEDS, WWR_HOST, parseRssItems, wwr } from "@/lib/server/sources/wwr";
import { UNKNOWN_COMPANY } from "@/lib/server/sources/types";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { safeUrl } from "@/lib/shared/url";
import { collect, fakeCtx } from "./helpers";

const rss = readFileSync(resolve(import.meta.dirname, "../../../fixtures/sources/wwr/programming.rss"), "utf8");
const itemCount = (rss.match(/<item>/g) ?? []).length;

const feedPath = (url: URL) => (url.origin === `https://${WWR_HOST}` ? url.pathname : null);

/** Só a categoria de programação existe; as demais devolvem 404. */
const serve = (url: URL): unknown => (feedPath(url) === "/categories/remote-programming-jobs.rss" ? rss : undefined);

describe("conector We Work Remotely", () => {
  it("declara os metadados da D-07 e está registrado", () => {
    expect(wwr.id).toBe("wwr");
    expect(wwr.fullSnapshot).toBe(true);
    expect(wwr.brazilian).toBe(false);
    expect(wwr.minIntervalMinutes).toBe(60);
    expect(wwr.allowedHosts).toEqual([WWR_HOST]);
    expect(wwr.attribution).toEqual({ label: "We Work Remotely", url: "https://weworkremotely.com", dofollow: false });
    expect(CONNECTORS.wwr).toBe(wwr);
    expect(WWR_CATEGORY_FEEDS.length).toBeGreaterThan(0);
  });

  it("coleta e normaliza a fixture (teste comum)", async () => {
    const raws = await collect(wwr.fetch(fakeCtx({ serve })));
    expect(raws).toHaveLength(itemCount);
    const jobs = raws.map(wwr.normalize).filter((j) => j !== null);
    expect(jobs).toHaveLength(itemCount);
    for (const j of jobs) {
      expect(j.externalId).toBeTruthy();
      expect(safeUrl(j.url, { allowHttp: true })).not.toBeNull();
      expect(j.url.startsWith("https://weworkremotely.com/remote-jobs/")).toBe(true);
      expect(j.title).toBeTruthy();
      expect(j.descriptionFormat).toBe("html");
      expect(j.workModeHint).toBe("remote");
    }
    expect(wwr.normalize({ lixo: true })).toBeNull();
  });

  it("divide 'Empresa: Cargo', decodifica a descrição e usa region como eligibleRegions", async () => {
    const jobs = (await collect(wwr.fetch(fakeCtx({ serve })))).map(wwr.normalize).filter((j) => j !== null);
    const first = jobs[0]!;
    expect(first.company).toBe("Toptal");
    expect(first.title).toBe("Cryptography Specialist for AI lab");
    expect(first.externalId).toBe("toptal-cryptography-specialist-for-ai-lab");
    expect(first.descriptionHtml).toContain("<p>");
    expect(first.descriptionHtml).not.toContain("&lt;");
    expect(first.publishedAt?.toISOString()).toBe("2026-11-05T17:09:07.000Z");
    expect(first.eligibleRegions).toEqual(["Worldwide"]);
    expect(first.country).toBeNull();
    const us = jobs.find((j) => j.eligibleRegions.includes("United States"))!;
    expect(us.country).toBe("US");
    expect(first.tags).toEqual(["Full-Stack Programming"]);
  });

  it("consulta cada categoria tech e junta sem repetir guid; categoria fora do ar vai para reportPartial", async () => {
    const ctx = fakeCtx({ serve });
    const raws = await collect(wwr.fetch(ctx));
    expect(ctx.requests.map((r) => new URL(r.url).pathname).sort()).toEqual(
      WWR_CATEGORY_FEEDS.map((f) => `/categories/${f}`).sort(),
    );
    expect(raws).toHaveLength(itemCount);
    expect(ctx.partials).toHaveLength(WWR_CATEGORY_FEEDS.length - 1);

    const both = fakeCtx({ serve: () => rss });
    expect(await collect(wwr.fetch(both))).toHaveLength(itemCount);
    expect(both.partials).toHaveLength(0);
  });

  it("se todas as categorias falham, lança erro", async () => {
    await expect(collect(wwr.fetch(fakeCtx({ serve: () => undefined })))).rejects.toThrow();
  });
});

describe("parseRssItems", () => {
  it("aceita CDATA e entidades escapadas nos mesmos campos", () => {
    const xml = `<rss><channel>
      <item><title><![CDATA[Acme & Co: Dev <Senior>]]></title><region>Anywhere in the World</region>
        <description><![CDATA[<p>Olá <b>mundo</b></p>]]></description><guid>https://weworkremotely.com/remote-jobs/a</guid><link>https://weworkremotely.com/remote-jobs/a</link></item>
      <item><title>Beta &amp; Co: Dev</title><description>&lt;p&gt;texto&lt;/p&gt;</description><link>https://weworkremotely.com/remote-jobs/b</link></item>
    </channel></rss>`;
    const items = parseRssItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: "Acme & Co: Dev <Senior>", description: "<p>Olá <b>mundo</b></p>" });
    expect(items[1]).toMatchObject({ title: "Beta & Co: Dev", description: "<p>texto</p>" });
    expect(parseRssItems("<html>não é rss</html>")).toEqual([]);
  });

  it("ignora item sem link e título sem empresa usa a empresa padrão", () => {
    expect(wwr.normalize({ title: "Sem link" })).toBeNull();
    const job = wwr.normalize({ title: "Dev Backend", link: "https://weworkremotely.com/remote-jobs/x-y" });
    expect(job?.title).toBe("Dev Backend");
    expect(job?.company).toBe(UNKNOWN_COMPANY);
  });

  it("rejeita link fora do host do We Work Remotely", () => {
    expect(wwr.normalize({ title: "A: B", link: "https://evil.example/remote-jobs/x" })).toBeNull();
  });
});
