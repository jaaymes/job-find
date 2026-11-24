import { describe, expect, it } from "vitest";
import { acceptBoard, techOnly } from "@/scripts/discover-boards/validate";
import type { NormalizedJob } from "@/lib/server/sources/types";

function job(over: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    externalId: "x:1",
    url: "https://example.com/1",
    title: "Engenheiro de Software",
    company: "Acme",
    companyLogoUrl: null,
    descriptionHtml: "",
    descriptionFormat: "html",
    country: null,
    city: null,
    locationText: null,
    eligibleRegions: [],
    workModeHint: null,
    seniorityHint: null,
    tags: [],
    salary: null,
    publishedAt: null,
    ...over,
  };
}

/** `tech` vagas de tecnologia e o resto `null` (o `normalize` do conector descarta o que não é tech). */
function normalized(total: number, tech: number, techOver: Partial<NormalizedJob>[] = []) {
  return Array.from({ length: total }, (_, i) => (i < tech ? job(techOver[i] ?? {}) : null));
}

describe("acceptBoard", () => {
  it("rejeita board sem vagas", () => {
    expect(acceptBoard({ slug: "vazio", boardName: null, total: 0, normalized: [] })).toEqual({
      accept: false,
      tech: 0,
      br: 0,
      reason: "sem vagas",
    });
  });

  it("rejeita board cujo nome confere com o slug mas não tem vaga tech nem BR", () => {
    const r = acceptBoard({ slug: "arco", boardName: "ARCO Companies", total: 10, normalized: normalized(10, 0) });
    expect(r.accept).toBe(false);
    expect(r.tech).toBe(0);
    expect(r.br).toBe(0);
    expect(r.reason).not.toBeNull();
  });

  it("aceita com 30% de vagas tech e nenhuma BR", () => {
    const r = acceptBoard({ slug: "acme", boardName: null, total: 10, normalized: normalized(10, 3) });
    expect(r).toEqual({ accept: true, tech: 3, br: 0, reason: null });
  });

  it("aceita com 1 vaga tech e 1 vaga BR mesmo abaixo de 30% tech", () => {
    const r = acceptBoard({
      slug: "acme",
      boardName: null,
      total: 10,
      normalized: normalized(10, 1, [{ country: "BR" }]),
    });
    expect(r).toEqual({ accept: true, tech: 1, br: 1, reason: null });
  });

  it("rejeita board com tech abaixo de 30% e nenhuma vaga BR", () => {
    const r = acceptBoard({ slug: "nuvem", boardName: "Nuvem Health", total: 10, normalized: normalized(10, 2) });
    expect(r.accept).toBe(false);
    expect(r.tech).toBe(2);
    expect(r.br).toBe(0);
  });

  it("conta como BR país BR ou região elegível que aceita o Brasil", () => {
    const regions = (eligibleRegions: string[]) => job({ country: "US", eligibleRegions });
    const r = acceptBoard({
      slug: "acme",
      boardName: null,
      total: 6,
      normalized: [
        job({ country: "BR" }),
        regions(["Brazil"]),
        regions(["LATAM"]),
        regions(["Worldwide"]),
        regions(["Europe"]),
        job({ country: "US" }),
      ],
    });
    expect(r.br).toBe(4);
    expect(r.tech).toBe(6);
  });

  it("rejeita quando o nome do board não tem relação com o slug", () => {
    const r = acceptBoard({ slug: "arco", boardName: "Outra Empresa", total: 4, normalized: normalized(4, 4) });
    expect(r.accept).toBe(false);
    expect(r.reason).toMatch(/nome/);
  });

  it("compõe normalize e isTechJob: vaga não tech conta em total mas não em tech", () => {
    const jobs = [
      job({ title: "Senior Software Engineer" }),
      job({ title: "Account Executive" }),
      job({ title: "Customer Success Manager" }),
      job({ title: "Backend Developer", tags: ["python"] }),
      null,
    ].map(techOnly);
    expect(jobs.map((j) => j?.title ?? null)).toEqual(["Senior Software Engineer", null, null, "Backend Developer", null]);
    const r = acceptBoard({ slug: "acme", boardName: null, total: 5, normalized: jobs });
    expect(r).toMatchObject({ tech: 2, accept: true });
    const onlySales = acceptBoard({
      slug: "acme",
      boardName: null,
      total: 3,
      normalized: [job({ title: "Account Executive" }), job({ title: "Recruiter" }), job({ title: "Sales Manager" })].map(techOnly),
    });
    expect(onlySales.accept).toBe(false);
  });
});
