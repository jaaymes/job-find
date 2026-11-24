import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import { metadata as jobMetadata } from "@/app/(site)/vagas/[id]/page";

describe("indexação", () => {
  it("robots.txt bloqueia a API para todos os robôs", () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    const all = rules.find((rule) => rule.userAgent === "*");
    expect(all).toBeDefined();
    const disallow = [all!.disallow].flat();
    expect(disallow).toContain("/api/");
  });

  it("a página de detalhe da vaga não é indexada", () => {
    expect(jobMetadata.robots).toMatchObject({ index: false });
  });
});
