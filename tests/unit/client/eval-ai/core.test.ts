import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultAiSettings } from "@/lib/client/ai/settings";
import { AiError } from "@/lib/client/ai/errors";
import {
  abortReason,
  costUsd,
  cvText,
  writeOutputs,
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
  it("carrega e valida os 11 pares fictícios", async () => {
    const pairs = await loadPairs(FIXTURES);
    expect(pairs.map((p) => p.id)).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"]);
    // Par 11: perfil abaixo da senioridade da vaga e ferramentas da vaga fora do perfil.
    const p11 = pairs[10];
    expect([p11.profile.seniority, p11.job.seniority]).toEqual(["mid", "senior"]);
    expect(p11.job.descriptionHtml).toMatch(/Datadog/);
    expect(JSON.stringify(p11.profile)).not.toMatch(/Datadog|Kubernetes|Grafana|Sênior/);
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
  it("roda os 11 pares: válidos sem violações, retentativa no 07 e no 11, JSON inválido no 09", async () => {
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
    expect(byId["11"]).toMatchObject({ validJson: true, calls: 2, violations: [] });
    expect(byId["09"]).toMatchObject({ validJson: false, calls: 2, error: "invalid_output", usage: null });
    for (const r of out.filter((x) => !["07", "09", "11"].includes(x.id))) {
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

describe("par 11: cópia da vaga", () => {
  it("a 1ª resposta copiada gera feedback de senioridade e ferramenta; se persistir, o relatório mostra", async () => {
    const pairs = await loadPairs(FIXTURES);
    const pair = pairs.find((p) => p.id === "11")!;
    const r = await evaluatePair(pair, { settings: defaultAiSettings(), resolveModel: mockResolverFor(pair, "pt", "persistent-copy") });
    expect(r).toMatchObject({ validJson: true, calls: 2 });
    const texts = r.violations.map((v) => v.text.toLowerCase());
    expect(texts).toEqual(expect.arrayContaining(["senior", "datadog", "grafana"]));
    const report = renderReport([r], null);
    expect(report).toMatch(/par 11: unknown_name "S[eê]nior"/i);
    expect(report).toContain('par 11: unknown_name "Datadog"');
    expect(summarize([r], null).pass).toBe(false);
  });
});

describe("--out", () => {
  it("grava o CV montado e a carta de cada par com documentos; pula os que falharam", async () => {
    const pairs = await loadPairs(FIXTURES);
    const pair = pairs.find((p) => p.id === "11")!;
    const copied = await evaluatePair(pair, { settings: defaultAiSettings(), resolveModel: mockResolverFor(pair, "pt", "persistent-copy") });
    const failed = result({ id: "09", validJson: false, docs: null, error: "invalid_output" });
    const dir = join(await mkdtemp(join(tmpdir(), "eval-out-")), "novo");
    const written = await writeOutputs(dir, pairs, [copied, failed]);
    expect((await readdir(dir)).sort()).toEqual(["11-carta.txt", "11-cv.txt"]);
    expect(written).toHaveLength(2);
    const cv = await readFile(join(dir, "11-cv.txt"), "utf8");
    expect(cv).toContain("Daniela Ficticia");
    expect(cv).toContain("[REVISAR] Desenvolvedora Back-end Sênior");
    expect(cv).toMatch(/- \[REVISAR\] Construiu a API.*Datadog/);
    expect(cv).toContain("Violações:");
    expect(await readFile(join(dir, "11-carta.txt"), "utf8")).toContain("Tenho interesse");
  });

  it("cvText marca experiência repetida", async () => {
    const [pair] = await loadPairs(FIXTURES);
    const exp = pair.profile.experiences[0];
    const docs = { cv: { headline: "h", summary: "s", skills: [], experiences: [{ expId: exp.id, bullets: [] }, { expId: exp.id, bullets: [] }] }, coverLetter: null };
    expect(cvText(pair, docs, "pt", [])).toContain("[REPETIDA]");
  });
});

describe("interrupção antecipada", () => {
  it("para em chave inválida, sem crédito, orçamento e rede; segue nos demais erros", () => {
    expect(abortReason(result({ validJson: false, error: "invalid_key" }))).toBe("invalid_key");
    expect(abortReason(result({ validJson: false, error: "no_credit" }))).toBe("no_credit");
    expect(abortReason(result({ validJson: false, error: "budget" }))).toBe("budget");
    expect(abortReason(result({ validJson: false, error: "unavailable", network: true }))).toBe("rede");
    expect(abortReason(result({ validJson: false, error: "unavailable", network: false }))).toBeNull();
    expect(abortReason(result({ validJson: false, error: "invalid_output" }))).toBeNull();
    expect(abortReason(result())).toBeNull();
  });

  it("evaluatePair reconhece a falha de rede (unavailable sem status) e a chave inválida", async () => {
    const [pair] = await loadPairs(FIXTURES);
    const throwing = (err: unknown) => async () => {
      throw err;
    };
    const net = await evaluatePair(pair, { settings: defaultAiSettings(), resolveModel: throwing(new AiError("unavailable", { retryable: true, meta: {} })) });
    expect(net).toMatchObject({ error: "unavailable", network: true });
    const http = await evaluatePair(pair, { settings: defaultAiSettings(), resolveModel: throwing(new AiError("unavailable", { meta: { status: 500 } })) });
    expect(http).toMatchObject({ error: "unavailable", network: false });
    // Fim anormal do stream (finishReason), mesmo indefinido: é do par, não da rede; não interrompe.
    for (const finishReason of ["error", undefined]) {
      const stream = await evaluatePair(pair, { settings: defaultAiSettings(), resolveModel: throwing(new AiError("unavailable", { retryable: true, meta: { finishReason } })) });
      expect(stream).toMatchObject({ error: "unavailable", network: false });
      expect(abortReason(stream)).toBeNull();
    }
    const key = await evaluatePair(pair, { settings: defaultAiSettings(), resolveModel: throwing(new AiError("invalid_key", { meta: { status: 401 } })) });
    expect(abortReason(key)).toBe("invalid_key");
  });

  it("o relatório e o resumo dizem onde parou e quantos pares não rodaram", () => {
    const aborted = { after: "03", reason: "invalid_key", skipped: 8 };
    const rs = [result(), result({ id: "02" }), result({ id: "03", validJson: false, error: "invalid_key", usage: null })];
    const s = summarize(rs, null, undefined, aborted);
    expect(s.pass).toBe(false);
    expect(s.failures.join(";")).toMatch(/interrompida no par 03 \(invalid_key\); 8 par\(es\) não rodaram/);
    expect(renderReport(rs, null, s, aborted)).toContain("Avaliação interrompida no par 03 por invalid_key: 8 par(es) restante(s) não rodaram.");
  });
});
