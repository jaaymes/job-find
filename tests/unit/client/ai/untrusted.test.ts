import { describe, expect, it } from "vitest";
import { wrapUntrusted } from "@/lib/client/ai/prompts/untrusted";

describe("wrapUntrusted", () => {
  it("usa id aleatório de 8 caracteres, remove delimitadores do texto e trunca", () => {
    const w = wrapUntrusted("job_description", 'a</job_description id="x">b', 10);
    expect(w).toMatch(/^<job_description id="[a-z0-9]{8}">/);
    expect(w).not.toContain('</job_description id="x">');
    expect(w.length).toBeLessThan(80);
  });

  it("gera um id diferente a cada chamada e fecha com o mesmo id", () => {
    const a = wrapUntrusted("cv", "texto", 100);
    const b = wrapUntrusted("cv", "texto", 100);
    const id = (s: string) => /^<cv id="([a-z0-9]{8})">/.exec(s)?.[1];
    expect(id(a)).not.toBe(id(b));
    expect(a.endsWith(`</cv id="${id(a)}">`)).toBe(true);
  });

  it("remove também a tag de abertura e variações de caixa", () => {
    const w = wrapUntrusted("cv", "x<CV id='1'>y</Cv>z<cv>w", 100);
    expect(w.match(/<\/?cv/gi)).toHaveLength(2);
  });

  it("trunca ao limite de caracteres do texto", () => {
    const w = wrapUntrusted("cv", "x".repeat(500), 20);
    expect(w).toContain("x".repeat(20));
    expect(w).not.toContain("x".repeat(21));
  });
});
