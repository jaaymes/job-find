import { describe, expect, it } from "vitest";
import { verifyCronSecret } from "@/lib/server/cron-auth";

describe("verifyCronSecret (SEC-04)", () => {
  it("rejeita header ausente, malformado ou segredo vazio", () => {
    expect(verifyCronSecret(null, "s")).toBe(false);
    expect(verifyCronSecret("", "s")).toBe(false);
    expect(verifyCronSecret("s3cr3t", "s3cr3t")).toBe(false);
    expect(verifyCronSecret("bearer s3cr3t", "s3cr3t")).toBe(false);
    expect(verifyCronSecret("Bearer  s3cr3t", "s3cr3t")).toBe(false);
    expect(verifyCronSecret("Bearer s3cr3t ", "s3cr3t")).toBe(false);
    expect(verifyCronSecret("Bearer ", "")).toBe(false);
    expect(verifyCronSecret("Bearer x", "")).toBe(false);
  });

  it("rejeita segredo errado, inclusive de tamanhos diferentes", () => {
    expect(verifyCronSecret("Bearer x", "s")).toBe(false);
    expect(verifyCronSecret("Bearer " + "a".repeat(32), "b".repeat(32))).toBe(false);
    expect(verifyCronSecret("Bearer s3cr3", "s3cr3t")).toBe(false);
  });

  it("aceita o segredo correto", () => {
    expect(verifyCronSecret("Bearer s3cr3t", "s3cr3t")).toBe(true);
  });
});
