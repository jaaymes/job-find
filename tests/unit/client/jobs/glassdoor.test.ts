import { describe, expect, it } from "vitest";
import { buildGlassdoorUrl, normalizeCompanyForSearch } from "@/lib/client/jobs/glassdoor";
import type { JobOrigin } from "@/lib/shared/types/job";

describe("normalizeCompanyForSearch", () => {
  it.each([
    ["Acme Tecnologia Ltda.", "Acme Tecnologia"],
    ["Foo S.A.", "Foo"],
    ["Foo S/A", "Foo"],
    ["Bar Inc.", "Bar"],
    ["Baz, LLC", "Baz"],
    ["Qux GmbH", "Qux"],
    ["Nubank (Nu Pagamentos)", "Nubank"],
    ["Acme Ltda ME", "Acme"],
    ["  Stone  ", "Stone"],
  ])("%s → %s", (input, out) => expect(normalizeCompanyForSearch(input)).toBe(out));

  it.each(["", "  ", "Ltda.", "(Confidencial)", "Confidencial", "Empresa Confidencial", "CONFIDENTIAL", "Stealth Startup", "Undisclosed", "Empresa", "N/A", "Não informado", "X"])(
    "%j → null",
    (input) => expect(normalizeCompanyForSearch(input)).toBeNull(),
  );
});

describe("buildGlassdoorUrl", () => {
  const parse = (c: string, o: JobOrigin) => new URL(buildGlassdoorUrl(c, o)!);
  it("nacional e desconhecida usam .com.br; internacional usa .com", () => {
    expect(parse("Nubank", "national").origin).toBe("https://www.glassdoor.com.br");
    expect(parse("Nubank", "unknown").origin).toBe("https://www.glassdoor.com.br");
    expect(parse("Stripe", "international").origin).toBe("https://www.glassdoor.com");
  });
  it("usa /Search/results.htm com keyword codificada", () => {
    const u = parse("Itaú & Cia Ltda", "national");
    expect(u.pathname).toBe("/Search/results.htm");
    expect(u.searchParams.get("keyword")).toBe("Itaú & Cia");
  });
  it("nome genérico → null", () => expect(buildGlassdoorUrl("Confidencial", "national")).toBeNull());
});
