import { describe, expect, it } from "vitest";
import { buildLinkedInSearchUrl } from "@/lib/client/jobs/linkedin-search";

const parse = (f: Parameters<typeof buildLinkedInSearchUrl>[0]) => new URL(buildLinkedInSearchUrl(f));

describe("buildLinkedInSearchUrl", () => {
  it("usa a base do LinkedIn com o geoId do Brasil", () => {
    const u = parse({});
    expect(u.origin + u.pathname).toBe("https://www.linkedin.com/jobs/search/");
    expect(u.searchParams.get("geoId")).toBe("106057199");
  });

  it("junta q e stacks em keywords, codificando os caracteres especiais", () => {
    expect(parse({ q: "São Paulo & C#", stacks: ["react", "node"] }).searchParams.get("keywords")).toBe(
      "São Paulo & C# react node",
    );
  });

  it("sem filtro usa keywords=desenvolvedor e f_TPR de 7 dias", () => {
    const u = parse({});
    expect(u.searchParams.get("keywords")).toBe("desenvolvedor");
    expect(u.searchParams.get("f_TPR")).toBe("r604800");
  });

  it.each([
    ["24h", "r86400"],
    ["7d", "r604800"],
    ["30d", "r2592000"],
  ] as const)("since %s vira f_TPR %s", (since, code) => {
    expect(parse({ since }).searchParams.get("f_TPR")).toBe(code);
  });

  it.each([
    ["remote", "2"],
    ["hybrid", "3"],
    ["onsite", "1"],
  ] as const)("workMode %s vira f_WT %s", (workMode, code) => {
    expect(parse({ workMode }).searchParams.get("f_WT")).toBe(code);
  });

  it("sem workMode não há f_WT", () => {
    expect(parse({}).searchParams.has("f_WT")).toBe(false);
  });

  it("seniority vira f_E com códigos separados por vírgula", () => {
    expect(parse({ seniority: ["junior", "senior"] }).searchParams.get("f_E")).toBe("2,4");
    expect(parse({ seniority: ["intern", "mid", "lead"] }).searchParams.get("f_E")).toBe("1,3,5");
    expect(parse({}).searchParams.has("f_E")).toBe(false);
  });
});
