import { describe, expect, it } from "vitest";
import { stripUrlQuery } from "@/lib/shared/analytics";

describe("stripUrlQuery", () => {
  it("remove a query string dos filtros de busca", () => {
    expect(stripUrlQuery("https://jobfind.app/vagas?q=meu%20nome&remoto=1")).toBe("https://jobfind.app/vagas");
  });

  it("remove o fragmento", () => {
    expect(stripUrlQuery("https://jobfind.app/privacidade#analytics")).toBe("https://jobfind.app/privacidade");
  });

  it("mantém a URL sem query intacta", () => {
    expect(stripUrlQuery("https://jobfind.app/vagas/abc")).toBe("https://jobfind.app/vagas/abc");
  });
});
