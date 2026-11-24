import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { enrichJob } from "@/lib/server/jobs/enrich-job";
import { REMOTEOK_HOST, remoteok } from "@/lib/server/sources/remoteok";
import { CONNECTORS, attributionFor } from "@/lib/server/sources/registry";
import { safeUrl } from "@/lib/shared/url";
import { collect, fakeCtx } from "./helpers";

type Item = Record<string, unknown> & { position?: string };

const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../fixtures/sources/remoteok/api.json"), "utf8"),
) as Item[];
const serve = (url: URL): unknown => (url.origin === "https://remoteok.com" && url.pathname === "/api" ? fixture : undefined);

describe("conector RemoteOK", () => {
  it("declara os metadados da D-07 e está registrado", () => {
    expect(remoteok.id).toBe("remoteok");
    expect(remoteok.fullSnapshot).toBe(true);
    expect(remoteok.brazilian).toBe(false);
    expect(remoteok.minIntervalMinutes).toBe(60);
    expect(remoteok.allowedHosts).toEqual([REMOTEOK_HOST]);
    expect(remoteok.attribution).toEqual({ label: "Remote OK", url: "https://remoteok.com", dofollow: true });
    expect(CONNECTORS.remoteok).toBe(remoteok);
  });

  it("ignora o item [0] (aviso legal) e coleta o restante (teste comum)", async () => {
    expect(fixture[0]).toHaveProperty("legal");
    const raws = await collect(remoteok.fetch(fakeCtx({ serve })));
    expect(raws).toHaveLength(fixture.length - 1);
    expect(raws.some((r) => "legal" in (r as object))).toBe(false);

    const jobs = raws.map(remoteok.normalize).filter((j) => j !== null);
    expect(jobs).toHaveLength(raws.length);
    for (const j of jobs) {
      expect(j.externalId).toBeTruthy();
      expect(safeUrl(j.url, { allowHttp: true })).not.toBeNull();
      expect(j.url.startsWith("https://remoteok.com/remote-jobs/")).toBe(true);
      expect(j.title).toBeTruthy();
      expect(j.descriptionFormat).toBe("html");
      expect(j.workModeHint).toBe("remote");
      expect(j.companyLogoUrl).toBeNull();
    }
    expect(remoteok.normalize({ lixo: true })).toBeNull();
    expect(remoteok.normalize(fixture[0])).toBeNull();
  });

  it("não exibe o logo deles, mesmo quando a API manda um", () => {
    const withLogo = { ...fixture[1], company_logo: "https://remoteok.com/assets/img/logo.png", logo: "https://remoteok.com/l.png" };
    expect(remoteok.normalize(withLogo)?.companyLogoUrl).toBeNull();
  });

  it("a URL é a página da vaga no RemoteOK, nunca o link de candidatura", () => {
    const job = remoteok.normalize({ ...fixture[1], apply_url: "https://empresa.example/apply", url: "https://remoteOK.com/remote-jobs/remote-x-1" });
    expect(job?.url).toBe("https://remoteok.com/remote-jobs/remote-x-1");
    expect(remoteok.normalize({ ...fixture[1], url: "https://empresa.example/apply" })).toBeNull();
  });

  it("mapeia empresa, tags, região, data e salário", () => {
    const first = remoteok.normalize(fixture[1])!;
    expect(first.company).toBe("Reddit");
    expect(first.tags).toEqual(["product"]);
    expect(first.eligibleRegions).toEqual(["United States"]);
    expect(first.country).toBe("US");
    expect(first.publishedAt?.toISOString()).toBe("2026-11-22T02:00:05.000Z");
    expect(first.salary).toBeNull();

    const paid = remoteok.normalize({ ...fixture[1], salary_min: 90000, salary_max: 120000, location: "Worldwide" })!;
    expect(paid.salary).toEqual({ min: 90000, max: 120000, currency: "USD", period: "year" });
    expect(paid.eligibleRegions).toEqual(["Worldwide"]);
    expect(paid.country).toBeNull();
  });

  it("o link da descrição sai sem nofollow (dofollow exigido pelos termos da API)", () => {
    expect(attributionFor("remoteok")).toEqual({ label: "Remote OK", dofollow: true });

    const sre = fixture.find((i) => i.position === "Senior SRE, Site Experience")!;
    const normalized = remoteok.normalize(sre)!;
    expect(normalized.descriptionHtml).toContain("<a ");
    const enriched = enrichJob(normalized, {
      id: "remoteok",
      brazilian: remoteok.brazilian,
      dofollow: remoteok.attribution.dofollow,
    })!;
    const rels = [...enriched.descriptionHtml.matchAll(/<a [^>]*rel="([^"]*)"/g)].map((m) => m[1]);
    expect(rels.length).toBeGreaterThan(0);
    for (const rel of rels) {
      expect(rel).toBe("noopener noreferrer");
      expect(rel).not.toContain("nofollow");
    }

    // Contraprova: uma fonte sem dofollow recebe nofollow no mesmo HTML.
    const other = enrichJob(normalized, { id: "jobicy", brazilian: false, dofollow: false })!;
    expect(other.descriptionHtml).toContain("nofollow");
  });

  it("se a API falha, lança erro", async () => {
    await expect(collect(remoteok.fetch(fakeCtx({ serve: () => undefined })))).rejects.toThrow();
    await expect(collect(remoteok.fetch(fakeCtx({ serve: () => ({ erro: true }) })))).rejects.toThrow();
  });

  it("repara mojibake (UTF-8 lido como latin1) em título, empresa e descrição, e preserva texto correto", () => {
    const broken = "It\u00e2\u0080\u0099s \u00c5\u008cURA";
    const job = remoteok.normalize({
      ...fixture[1],
      position: "Engenheiro S\u00c3\u00a3o",
      company: "\u00c5\u008cURA",
      description: `<p>${broken}</p>`,
    })!;
    expect(job.title).toBe("Engenheiro São");
    expect(job.company).toBe("ŌURA");
    expect(job.descriptionHtml).toBe("<p>It\u2019s \u014cURA</p>");

    const ok = remoteok.normalize({ ...fixture[1], position: "Dev em São Paulo", company: "Naïve", description: "<p>naïve café — it\u2019s</p>" })!;
    expect(ok.title).toBe("Dev em São Paulo");
    expect(ok.company).toBe("Naïve");
    expect(ok.descriptionHtml).toBe("<p>naïve café — it\u2019s</p>");
  });

  it("nenhuma descrição da fixture sai com mojibake", async () => {
    const jobs = (await collect(remoteok.fetch(fakeCtx({ serve })))).map(remoteok.normalize).filter((j) => j !== null);
    for (const j of jobs) expect(`${j.title}${j.company}${j.descriptionHtml}`).not.toMatch(/[\u00c2-\u00f4][\u0080-\u00bf]/);
  });
});
