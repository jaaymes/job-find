import { describe, expect, it } from "vitest";
import { contentHash, dedupeKey } from "@/lib/server/enrich/dedupe";

describe("dedupeKey", () => {
  it("normaliza caixa, acento e espaços", () => {
    expect(
      dedupeKey({ company: "Lumen Pay", title: "Dev  Frontend", country: "BR", city: "São Paulo", workMode: "remote" }),
    ).toBe(
      dedupeKey({ company: "lumen pay", title: "dev frontend", country: "BR", city: "sao paulo", workMode: "remote" }),
    );
  });
  it("cidade diferente é vaga diferente (RN-05)", () => {
    expect(
      dedupeKey({ company: "X", title: "Dev", country: "BR", city: "Recife", workMode: "onsite" }),
    ).not.toBe(
      dedupeKey({ company: "X", title: "Dev", country: "BR", city: "Natal", workMode: "onsite" }),
    );
  });
  it("é sha1 hex", () => {
    expect(
      dedupeKey({ company: "X", title: "Dev", country: null, city: null, workMode: "unknown" }),
    ).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("contentHash", () => {
  it("é determinístico e sensível ao conteúdo", () => {
    expect(contentHash(["a", "b"])).toBe(contentHash(["a", "b"]));
    expect(contentHash(["a", "b"])).not.toBe(contentHash(["a", "c"]));
    expect(contentHash(["ab", "c"])).not.toBe(contentHash(["a", "bc"]));
    expect(contentHash(["a"])).toMatch(/^[0-9a-f]{40}$/);
  });
});
