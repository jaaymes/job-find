import { describe, expect, it } from "vitest";
import { computeContentHash, enrichJob } from "@/lib/server/jobs/enrich-job";
import { SANITIZER_VERSION } from "@/lib/server/sanitize";
import { UNKNOWN_COMPANY, type NormalizedJob } from "@/lib/server/sources/types";

const src = { id: "greenhouse", brazilian: false, dofollow: false } as const;

function norm(over: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    externalId: "1",
    url: "https://boards.example.com/acme/1?utm_source=x#apply",
    title: "Senior React Developer",
    company: "Acme",
    companyLogoUrl: null,
    descriptionHtml: "<p>Build things with React</p><script>alert(1)</script>",
    descriptionFormat: "html",
    country: "br",
    city: "São Paulo",
    locationText: "São Paulo, Brazil",
    eligibleRegions: [],
    workModeHint: "remote",
    seniorityHint: null,
    tags: ["react"],
    salary: null,
    publishedAt: null,
    ...over,
  };
}

describe("enrichJob", () => {
  it("enriquece uma vaga de tecnologia", () => {
    const j = enrichJob(norm(), src);
    expect(j).not.toBeNull();
    if (!j) return;
    expect(j.descriptionHtml).toBe("<p>Build things with React</p>");
    expect(j.searchBody).toBe("Build things with React");
    expect(j.urlCanonical).toBe("https://boards.example.com/acme/1");
    expect(j.country).toBe("BR");
    expect(j.origin).toBe("national");
    expect(j.workMode).toBe("remote");
    expect(j.seniority).toBe("senior");
    expect(j.stacks).toContain("react");
    expect(j.dedupeKey).toMatch(/^[0-9a-f]{40}$/);
    expect(j.contentHash).toMatch(/^[0-9a-f]{40}$/);
    expect(j.publishedAt).toBeNull();
  });

  it("empresa desconhecida: a chave de dedup vem de source:externalId, não do texto genérico", () => {
    const key = (over: Partial<NormalizedJob>) => enrichJob(norm({ company: UNKNOWN_COMPANY, ...over }), src)!.dedupeKey;
    expect(key({ externalId: "1" })).not.toBe(key({ externalId: "2" }));
    expect(key({ externalId: "1" })).toBe(key({ externalId: "1" }));
    expect(key({ company: "", externalId: "1" })).not.toBe(key({ company: "", externalId: "2" }));
    // empresa conhecida continua deduplicando por empresa + título, independentemente do externalId
    expect(key({ company: "Acme", externalId: "1" })).toBe(key({ company: "Acme", externalId: "2" }));
  });

  it("devolve null para vaga que não é de tecnologia e para URL inválida", () => {
    expect(enrichJob(norm({ title: "Sales Manager", tags: [] }), src)).toBeNull();
    expect(enrichJob(norm({ url: "javascript:alert(1)" }), src)).toBeNull();
  });

  it("renderiza markdown com markdownToSafeHtml", () => {
    const j = enrichJob(norm({ descriptionFormat: "markdown", descriptionHtml: "- item um\n- item dois\n\n<b>cru</b>" }), src);
    expect(j?.descriptionHtml).toContain("<li>item um</li>");
    expect(j?.descriptionHtml).not.toContain("<b>");
  });

  it("o content hash muda com o conteúdo e é estável sem mudança", () => {
    const a = enrichJob(norm(), src);
    const b = enrichJob(norm(), src);
    const c = enrichJob(norm({ descriptionHtml: "<p>Outro</p>" }), src);
    expect(a?.contentHash).toBe(b?.contentHash);
    expect(c?.contentHash).not.toBe(a?.contentHash);
  });

  it("reaproveita o HTML salvo quando o hash bruto não mudou", () => {
    const a = enrichJob(norm(), src);
    if (!a) throw new Error("esperava vaga");
    const reused = enrichJob(norm(), src, { contentHash: a.contentHash, descriptionHtml: "<p>salvo</p>" });
    expect(reused?.descriptionHtml).toBe("<p>salvo</p>");
    const diff = enrichJob(norm(), src, { contentHash: "outro", descriptionHtml: "<p>salvo</p>" });
    expect(diff?.descriptionHtml).toBe("<p>Build things with React</p>");
  });

  it("computeContentHash é o mesmo hash que o enrichJob grava", () => {
    expect(enrichJob(norm(), src)?.contentHash).toBe(computeContentHash(norm()));
  });

  it("o hash inclui a versão do sanitizador", () => {
    expect(computeContentHash(norm(), SANITIZER_VERSION + 1)).not.toBe(computeContentHash(norm()));
    expect(computeContentHash(norm(), SANITIZER_VERSION)).toBe(computeContentHash(norm()));
  });

  it("subir a versão do sanitizador força a re-sanitização do HTML salvo", () => {
    // HTML gravado por uma versão anterior do sanitizador, com o hash daquela versão.
    const stale = { contentHash: computeContentHash(norm(), SANITIZER_VERSION - 1), descriptionHtml: "<p>velho</p>" };
    const j = enrichJob(norm(), src, stale);
    expect(j?.descriptionHtml).toBe("<p>Build things with React</p>");
    expect(j?.sanitizerVersion).toBe(SANITIZER_VERSION);
  });

  it("descarta salário com moeda inválida e normaliza o válido", () => {
    expect(enrichJob(norm({ salary: { min: 1, max: 2, currency: "reais", period: "month" } }), src)?.salaryCurrency).toBeNull();
    const ok = enrichJob(norm({ salary: { min: 1000, max: null, currency: "usd", period: "year" } }), src);
    expect(ok).toMatchObject({ salaryMin: 1000, salaryMax: null, salaryCurrency: "USD", salaryPeriod: "year" });
  });
});
