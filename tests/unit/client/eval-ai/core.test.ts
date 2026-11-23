import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultAiSettings } from "@/lib/client/ai/settings";
import {
  costUsd,
  evaluatePair,
  formatCost,
  loadPairs,
  percentile,
  renderReport,
  summarize,
  type PairResult,
} from "@/scripts/eval-ai/core";
import { MOCK_SCENARIOS, mockResolverFor } from "@/scripts/eval-ai/mock";
import { pickLanguage } from "@/lib/client/ai/prompts/cv.tailor.v1";

const FIXTURES = resolve(import.meta.dirname, "../../../fixtures/ai/pairs");

const result = (over: Partial<PairResult> = {}): PairResult => ({
  id: "01",
  lang: "pt",
  validJson: true,
  calls: 1,
  violations: [],
  ms: 1000,
  usage: { inputTokens: 1000, outputTokens: 500 },
  error: null,
  ...over,
});

describe("percentile", () => {
  it("usa o posto mais próximo", () => {
    const v = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(100);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([3, 1, 2], 50)).toBe(2);
  });
  it("lista vazia dá NaN", () => expect(percentile([], 95)).toBeNaN());
});

describe("custo", () => {
  it("converte tokens em USD só com preço conhecido", () => {
    expect(costUsd({ inputTokens: 1_000_000, outputTokens: 500_000 }, { priceIn: 2, priceOut: 4 })).toBe(4);
    expect(costUsd({ inputTokens: 10, outputTokens: 10 }, null)).toBeNull();
    expect(costUsd(null, { priceIn: 1, priceOut: 1 })).toBeNull();
    expect(costUsd({ inputTokens: 10 }, { priceIn: 1, priceOut: 1 })).toBeNull();
  });
  it("formata custo", () => {
    expect(formatCost(null)).toBe("n/d");
    expect(formatCost(0.00123)).toBe("US$ 0.00123");
    expect(formatCost(1.5)).toBe("US$ 1.5000");
  });
});

describe("summarize", () => {
  it("aprova com zero violações, JSON válido e p95 dentro do limite", () => {
    const s = summarize([result(), result({ id: "02", ms: 3000 })], { priceIn: 1, priceOut: 2 });
    expect(s).toMatchObject({ persistentTotal: 0, invalidJson: 0, pass: true, p50Ms: 1000, p95Ms: 3000 });
    expect(s.costUsd).toBeCloseTo(2 * 0.002);
  });
  it("reprova por violação persistente", () => {
    const v = { kind: "unknown_number", text: "87%", where: { part: "cv" }, key: "k" } as const;
    const s = summarize([result({ violations: [v] })], null);
    expect(s.pass).toBe(false);
    expect(s.persistentTotal).toBe(1);
    expect(s.costUsd).toBeNull();
  });
  it("reprova por JSON inválido e por p95 acima de 60 s", () => {
    expect(summarize([result({ validJson: false })], null).pass).toBe(false);
    expect(summarize([result({ ms: 60_001 })], null).failures.join()).toContain("p95");
    expect(summarize([result({ ms: 60_000 })], null).pass).toBe(true);
  });
});

describe("renderReport", () => {
  it("imprime todas as colunas, o resumo e o detalhe", () => {
    const text = renderReport([result(), result({ id: "02", validJson: false, calls: 2, usage: null, error: "invalid_output" })], null);
    expect(text).toContain("JSON válido");
    expect(text).toMatch(/01\s+pt\s+sim\s+1\s+0/);
    expect(text).toMatch(/02\s+pt\s+não\s+2\s+n\/d/);
    expect(text).toContain("Tempo p50 / p95");
    expect(text).toContain("REPROVADO");
    expect(text).toContain("par 02: erro invalid_output");
  });
});

describe("loadPairs", () => {
  it("carrega e valida os 10 pares fictícios", async () => {
    const pairs = await loadPairs(FIXTURES);
    expect(pairs.map((p) => p.id)).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10"]);
    const langs = new Set(pairs.map((p) => pickLanguage(p.job)));
    expect(langs).toEqual(new Set(["pt", "en", "es"]));
    expect(new Set(pairs.map((p) => p.profile.seniority))).toEqual(new Set(["junior", "mid", "senior", "lead"]));
    for (const p of pairs) {
      expect(p.profile.contact.email).toMatch(/@exemplo\.test$/);
      expect(p.job.urlCanonical).toContain("exemplo.test");
    }
    expect(Math.max(...pairs.map((p) => p.job.descriptionHtml.length))).toBeGreaterThan(12_000);
  });
  it("aponta o arquivo e o campo de um par inválido", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pairs-"));
    await writeFile(join(dir, "01.json"), JSON.stringify({ profile: {}, job: {} }));
    await expect(loadPairs(dir)).rejects.toThrow(/01\.json: par inválido/);
    await writeFile(join(dir, "01.json"), "{ nope");
    await expect(loadPairs(dir)).rejects.toThrow("01.json: JSON ilegível");
  });
  it("falha sem nenhum par", async () => {
    await expect(loadPairs(await mkdtemp(join(tmpdir(), "vazio-")))).rejects.toThrow(/nenhum par/);
  });
});

describe("evaluatePair com modelo falso (sem rede)", () => {
  it("roda os 10 pares: válidos sem violações, retentativa no 07, JSON inválido no 09", async () => {
    const pairs = await loadPairs(FIXTURES);
    let t = 0;
    const out: PairResult[] = [];
    for (const p of pairs) {
      const lang = pickLanguage(p.job);
      out.push(
        await evaluatePair(p, {
          settings: defaultAiSettings(),
          resolveModel: mockResolverFor(p, lang, MOCK_SCENARIOS[p.id] ?? "clean"),
          now: () => (t += 10),
        }),
      );
    }
    const byId = Object.fromEntries(out.map((r) => [r.id, r]));
    expect(byId["07"]).toMatchObject({ validJson: true, calls: 2, violations: [] });
    expect(byId["09"]).toMatchObject({ validJson: false, calls: 2, error: "invalid_output", usage: null });
    for (const r of out.filter((x) => x.id !== "07" && x.id !== "09")) {
      expect(r).toMatchObject({ validJson: true, calls: 1, violations: [], ms: 10 });
      expect(r.usage?.inputTokens).toBeGreaterThan(0);
    }
    const s = summarize(out, null);
    expect(s).toMatchObject({ persistentTotal: 0, invalidJson: 1, pass: false });
    expect(renderReport(out, null, s)).toContain("n/d");
  });

  it("violação que sobrevive à retentativa conta como persistente", async () => {
    const [pair] = await loadPairs(FIXTURES);
    const r = await evaluatePair(pair, {
      settings: defaultAiSettings(),
      resolveModel: mockResolverFor(pair, "pt", "persistent-invention"),
    });
    expect(r).toMatchObject({ validJson: true, calls: 2 });
    expect(r.violations.map((v) => v.kind)).toEqual(["unknown_number"]);
    expect(summarize([r], null)).toMatchObject({ persistentTotal: 1, pass: false });
  });
});
