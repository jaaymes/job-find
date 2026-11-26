import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultAiSettings } from "@/lib/client/ai/settings";
import { loadPairs, runAssistSuite } from "@/scripts/eval-ai/core";
import { assistMockResolverFor } from "@/scripts/eval-ai/mock";

const FIXTURES = resolve(import.meta.dirname, "../../../fixtures/ai/pairs");

/** Os perfis dos pares 01..10 (o par 11 é específico da suíte de CV). */
async function tenProfiles() {
  return (await loadPairs(FIXTURES)).filter((p) => p.id <= "10");
}

describe("runAssistSuite com modelo falso (sem rede)", () => {
  it("faz 30 gerações (3 por perfil) e não mede nada inventado nem sensível", async () => {
    const profiles = await tenProfiles();
    expect(profiles).toHaveLength(10);
    const report = await runAssistSuite(profiles, {
      settings: defaultAiSettings(),
      resolveModelFor: (p) => assistMockResolverFor(p.profile),
    });
    expect(report.generations).toBe(30);
    expect(report.invented).toBe(0);
    expect(report.sensitive).toBe(0);
    expect(report.failures).toEqual([]);
    expect(Number.isFinite(report.p95Ms)).toBe(true);
  });

  it("conta o número inventado na redação e registra a falha", async () => {
    const profiles = await tenProfiles();
    const report = await runAssistSuite(profiles, {
      settings: defaultAiSettings(),
      resolveModelFor: (p) => assistMockResolverFor(p.profile, { inventedNumber: true }),
    });
    expect(report.generations).toBe(30);
    expect(report.invented).toBeGreaterThanOrEqual(1);
    expect(report.failures.length).toBeGreaterThanOrEqual(1);
    expect(report.failures[0]).toMatchObject({ step: "write" });
  });

  it("conta perguntas sensíveis feitas pelo modelo", async () => {
    const profiles = (await tenProfiles()).slice(0, 2);
    const report = await runAssistSuite(profiles, {
      settings: defaultAiSettings(),
      resolveModelFor: (p) => assistMockResolverFor(p.profile, { sensitiveQuestion: true }),
    });
    expect(report.sensitive).toBeGreaterThanOrEqual(2);
    expect(report.failures.some((f) => f.step === "questions")).toBe(true);
  });

  it("campo vazio ou nulo conta como falha, não como geração limpa (#26)", async () => {
    const profiles = (await tenProfiles()).slice(0, 2);
    const report = await runAssistSuite(profiles, {
      settings: defaultAiSettings(),
      resolveModelFor: (p) => assistMockResolverFor(p.profile, { emptyField: true }),
    });
    expect(report.failures.filter((f) => f.step === "write")).toHaveLength(2);
    expect(report.failures.filter((f) => f.step === "rewrite")).toHaveLength(2);
  });
});
