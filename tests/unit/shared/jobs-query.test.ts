import { describe, expect, it } from "vitest";
import { jobsQuerySchema, parseJobsQuery } from "@/lib/shared/schemas/jobs-query";

const parse = (qs: string) => parseJobsQuery(new URLSearchParams(qs));

describe("parseJobsQuery", () => {
  it("aplica os padrões", () => {
    const r = parse("");
    expect(r).toEqual({ ok: true, value: { stacksMode: "any", limit: 30 } });
  });

  it("rejeita q com mais de 100 caracteres", () => {
    expect(parseJobsQuery(new URLSearchParams("q=" + "x".repeat(101))).ok).toBe(false);
  });

  it("q só com espaços vira undefined", () => {
    const r = parse("q=%20%20%20");
    expect(r.ok && r.value.q).toBeUndefined();
  });

  it("faz trim do q", () => {
    const r = parse("q=%20react%20");
    expect(r.ok && r.value.q).toBe("react");
  });

  it("limit fora de 1-90 é erro invalid_query", () => {
    const r = parse("limit=500");
    expect(r).toEqual({ ok: false, error: { code: "invalid_query", message: expect.any(String) } });
    expect(parse("limit=0").ok).toBe(false);
    expect(parse("limit=abc").ok).toBe(false);
    expect(parse("limit=90").ok).toBe(true);
  });

  it("normaliza stacks, aceita vírgula e chaves repetidas, e remove duplicatas", () => {
    const r = parse("stacks=ReactJS,vue&stacks=react");
    expect(r.ok && r.value.stacks).toEqual(["react", "vue"]);
  });

  it("stacks só com nomes desconhecidos viram filtro vazio (sem resultado), não somem", () => {
    const r = parse("stacks=naoexiste,outra");
    expect(r.ok && r.value.stacks).toEqual([]);
    const mixed = parse("stacks=naoexiste,react");
    expect(mixed.ok && mixed.value.stacks).toEqual(["react"]);
  });

  it("aceita no máximo 10 stacks", () => {
    const many = Array.from({ length: 11 }, (_, i) => `s${i}`).join(",");
    expect(parse(`stacks=${many}`).ok).toBe(false);
  });

  it("valida enums e listas", () => {
    expect(parse("origin=mars").ok).toBe(false);
    expect(parse("workMode=unknown").ok).toBe(false);
    expect(parse("since=1y").ok).toBe(false);
    expect(parse("lang=fr").ok).toBe(false);
    const r = parse("seniority=junior,senior&source=lever,ashby&workMode=remote&since=7d&lang=pt");
    expect(r).toEqual({
      ok: true,
      value: {
        stacksMode: "any",
        limit: 30,
        seniority: ["junior", "senior"],
        source: ["lever", "ashby"],
        workMode: "remote",
        since: "7d",
        lang: "pt",
      },
    });
    expect(parse("source=naoexiste").ok).toBe(false);
  });

  it("converte acceptsBrazil em boolean", () => {
    const t = parse("acceptsBrazil=true");
    const f = parse("acceptsBrazil=false");
    expect(t.ok && t.value.acceptsBrazil).toBe(true);
    expect(f.ok && f.value.acceptsBrazil).toBe(false);
    expect(parse("acceptsBrazil=talvez").ok).toBe(false);
  });

  it("aceita os ids de fonte fourdayweek e getonboard", () => {
    expect(() =>
      jobsQuerySchema.parse({ source: ["fourdayweek", "getonboard"] }),
    ).not.toThrow();
  });
});
