import { describe, expect, it } from "vitest";
import { decodeEntities, fixMojibake } from "@/lib/server/sources/text";

describe("fixMojibake", () => {
  it("repara UTF-8 lido como latin1", () => {
    expect(fixMojibake("It\u00e2\u0080\u0099s")).toBe("It\u2019s");
    expect(fixMojibake("S\u00c3\u00a3o Paulo")).toBe("São Paulo");
    expect(fixMojibake("a\u00c2\u00a0b")).toBe("a\u00a0b");
  });

  it("não altera texto correto nem texto que não cabe em latin1", () => {
    for (const ok of ["São Paulo", "naïve", "café", "It\u2019s", "plain", "日本語 â"]) expect(fixMojibake(ok)).toBe(ok);
  });

  it("descarta a reparação quando ela geraria U+FFFD", () => {
    const invalid = "x\u00c3\u0028";
    expect(fixMojibake(invalid)).toBe(invalid);
  });
});

describe("decodeEntities", () => {
  it("decodifica uma vez só", () => {
    expect(decodeEntities("&amp;lt;&#x2F;&#39;")).toBe("&lt;/'");
  });
});
