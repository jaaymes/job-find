import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GUPY_HOST, GUPY_TERMS, gupy } from "@/lib/server/sources/gupy";
import { CONNECTORS } from "@/lib/server/sources/registry";
import { collect, fakeCtx } from "./helpers";

type Job = { id: string; type: string; jobUrl: string };
const fixture = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../fixtures/sources/gupy/search.json"), "utf8"),
) as { data: Job[] };

/** Serve a fixture para o primeiro termo e lista vazia para os demais. */
function serveFirstTerm(url: URL): unknown {
  if (url.origin !== `https://${GUPY_HOST}` || url.pathname !== "/api/job-search/jobs") return undefined;
  return url.searchParams.get("jobName") === GUPY_TERMS[0] && url.searchParams.get("offset") === "0"
    ? fixture
    : { data: [] };
}

describe("conector Gupy", () => {
  it("declara os metadados e está registrado", () => {
    expect(gupy.id).toBe("gupy");
    expect(gupy.fullSnapshot).toBe(false);
    expect(gupy.minIntervalMinutes).toBe(60);
    expect(gupy.allowedHosts).toEqual([GUPY_HOST]);
    expect(gupy.revisitsCatalogWithinHours).toBe(24);
    expect(CONNECTORS.gupy).toBe(gupy);
  });

  it("percorre todos os termos e zera o cursor ao fim da volta", async () => {
    const ctx = fakeCtx({ serve: serveFirstTerm });
    const raws = await collect(gupy.fetch(ctx));
    expect(raws).toHaveLength(fixture.data.length);
    const terms = new Set(ctx.requests.map((r) => new URL(r.url).searchParams.get("jobName")));
    expect(terms.size).toBe(GUPY_TERMS.length);
    expect(ctx.cursors).toEqual([null]);
  });

  it("pagina de 100 em 100 enquanto a página vem cheia", async () => {
    const full = { data: Array.from({ length: 100 }, (_, i) => ({ ...fixture.data[0], id: String(i) })) };
    const ctx = fakeCtx({
      serve: (url) => {
        if (url.searchParams.get("jobName") !== GUPY_TERMS[0]) return { data: [] };
        return url.searchParams.get("offset") === "0" ? full : { data: [{ ...fixture.data[0], id: "x" }] };
      },
    });
    const raws = await collect(gupy.fetch(ctx));
    expect(raws).toHaveLength(101);
    const offsets = ctx.requests
      .filter((r) => new URL(r.url).searchParams.get("jobName") === GUPY_TERMS[0])
      .map((r) => new URL(r.url).searchParams.get("offset"));
    expect(offsets).toEqual(["0", "100"]);
  });

  it("não repete a mesma vaga achada por termos diferentes", async () => {
    const ctx = fakeCtx({ serve: () => fixture });
    const raws = (await collect(gupy.fetch(ctx))) as Job[];
    expect(raws.map((r) => r.id)).toEqual(fixture.data.map((j) => j.id));
  });

  it("no prazo grava o próximo termo e retoma dele", async () => {
    const ctx = fakeCtx({ serve: serveFirstTerm, deadlineAt: 0, cursor: "3" });
    await collect(gupy.fetch(ctx));
    expect(ctx.requests).toHaveLength(1);
    expect(new URL(ctx.requests[0]!.url).searchParams.get("jobName")).toBe(GUPY_TERMS[3]);
    expect(ctx.cursors).toEqual(["4"]);
  });

  it("cursor inválido recomeça do primeiro termo", async () => {
    const ctx = fakeCtx({ serve: serveFirstTerm, deadlineAt: 0, cursor: "999" });
    await collect(gupy.fetch(ctx));
    expect(new URL(ctx.requests[0]!.url).searchParams.get("jobName")).toBe(GUPY_TERMS[0]);
  });

  it("falha com resposta fora do formato", async () => {
    const ctx = fakeCtx({ serve: () => ({ outra: 1 }) });
    await expect(collect(gupy.fetch(ctx))).rejects.toThrow("Gupy: resposta fora do formato esperado");
  });

  it("normaliza vaga remota, híbrida no exterior e presencial em São Paulo", () => {
    const [remote, abroad, onsite] = fixture.data.map((j) => gupy.normalize(j));
    expect(remote).toMatchObject({
      externalId: "12927144",
      title: "Desenvolvedor Full Stack Java/React - Sênior",
      workModeHint: "remote",
      country: "BR",
      locationText: "Brasil",
      eligibleRegions: ["Brazil"],
      tags: ["PJ"],
      descriptionFormat: "html",
    });
    expect(remote!.url).toMatch(/^https:\/\/fcamara\.gupy\.io\/job\//);
    expect(remote!.publishedAt?.toISOString()).toBe("2026-11-23T12:06:22.498Z");

    expect(abroad).toMatchObject({ workModeHint: "hybrid", country: null, city: "Bogotá, D.c.", eligibleRegions: [] });
    expect(onsite).toMatchObject({
      workModeHint: "onsite",
      country: "BR",
      city: "São Paulo",
      locationText: "São Paulo, São Paulo, Brasil",
      company: "Grupo Mater",
      tags: ["CLT"],
    });
  });

  it("descarta banco de talentos, URL fora da Gupy e lixo", () => {
    const talentPool = fixture.data.find((j) => j.type === "vacancy_type_talent_pool");
    const foreign = fixture.data.find((j) => j.jobUrl.startsWith("https://evil."));
    expect(gupy.normalize(talentPool)).toBeNull();
    expect(gupy.normalize(foreign)).toBeNull();
    expect(gupy.normalize({ lixo: true })).toBeNull();
  });
});
