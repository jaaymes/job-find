import { describe, expect, it } from "vitest";
import { contentHash, dedupeKey, normalizeCompany, normalizeTitle } from "@/lib/server/enrich/dedupe";

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

describe("normalizeCompany", () => {
  it("remove sufixo societário no fim", () => {
    expect(normalizeCompany("resonads GmbH")).toBe("resonads");
    expect(normalizeCompany("Enterprise Management Solutions, Inc.")).toBe("enterprise management solutions");
    expect(normalizeCompany("Nu Pagamentos S.A.")).toBe("nu pagamentos");
    expect(normalizeCompany("Foo Co., Ltd.")).toBe("foo");
    expect(normalizeCompany("Lumen Pay Ltda")).toBe("lumen pay");
  });
  it("não remove no meio nem palavras genéricas", () => {
    expect(normalizeCompany("Acme Labs")).not.toBe(normalizeCompany("Acme"));
    expect(normalizeCompany("Coinbase")).toBe("coinbase");
    expect(normalizeCompany("Inc Studio")).toBe("inc studio");
  });
  it("nome que é só sufixo não fica vazio", () => {
    expect(normalizeCompany("GmbH")).toBe("gmbh");
    expect(normalizeCompany("S.A.")).not.toBe("");
  });
});

describe("normalizeTitle", () => {
  it("remove marcador de gênero", () => {
    expect(normalizeTitle("Backend Developer (m/w/d)")).toBe("backend developer");
    expect(normalizeTitle("Backend Developer (f/m/d)")).toBe("backend developer");
    expect(normalizeTitle("Desenvolvedor(a) Python")).toBe("desenvolvedor python");
    expect(normalizeTitle("Dev [all genders]")).toBe("dev");
  });
  it("remove segmento final só de modo ou região", () => {
    expect(normalizeTitle("Sr. Backend Engineer - Remote")).toBe("senior backend engineer");
    expect(normalizeTitle("Engenheiro de Dados (Remoto - Brasil)")).toBe("engenheiro de dados");
    expect(normalizeTitle("Frontend Engineer | LATAM")).toBe("frontend engineer");
    expect(normalizeTitle("Remote Sensing Engineer")).toBe("remote sensing engineer");
  });
  it("iguala abreviações de senioridade", () => {
    expect(normalizeTitle("Jr Dev")).toBe(normalizeTitle("Junior Dev"));
    expect(normalizeTitle("Dev PL")).toBe("dev pleno");
  });
  it("não funde cargos distintos", () => {
    expect(normalizeTitle("Data Engineer")).not.toBe(normalizeTitle("Data Developer"));
    expect(normalizeTitle("C# Developer")).not.toBe(normalizeTitle("C++ Developer"));
    expect(normalizeTitle(".NET Developer")).not.toBe(normalizeTitle("Developer"));
  });
  it("tolera título gigante com muitos segmentos finais em tempo linear", () => {
    const title = "x" + " - remote".repeat(5000);
    const start = performance.now();
    expect(normalizeTitle(title)).toBe("x");
    expect(performance.now() - start).toBeLessThan(50);
  });
  it("PL só vira pleno como palavra isolada", () => {
    expect(normalizeTitle("PL/SQL Developer")).not.toBe(normalizeTitle("Pleno SQL Developer"));
    expect(normalizeTitle("Dev PL")).toBe("dev pleno");
  });
  it("trata travessão como separador", () => {
    expect(normalizeTitle("Dev — Remote")).toBe("dev");
  });
  it("só remove a/o entre parênteses, nunca a palavra solta", () => {
    expect(normalizeTitle("Analista a Distância")).toBe("analista a distancia");
    expect(normalizeTitle("Engenheiro (a)")).toBe("engenheiro");
  });
});

it("dedupeKey: ATS e agregador com sufixo e marcador diferentes geram a mesma chave", () => {
  const loc = { country: "DE", city: "Berlin", workMode: "onsite" } as const;
  expect(dedupeKey({ company: "resonads GmbH", title: "Backend Developer (m/w/d)", ...loc })).toBe(
    dedupeKey({ company: "resonads", title: "Backend Developer", ...loc }),
  );
});
