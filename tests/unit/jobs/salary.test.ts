import { describe, expect, it } from "vitest";
import { formatSalary } from "@/components/jobs/format";

const base = { salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null } as const;
const sal = (over: Partial<Parameters<typeof formatSalary>[0]>) => formatSalary({ ...base, ...over });

describe("formatSalary", () => {
  it("devolve null sem salário", () => expect(formatSalary(base)).toBeNull());

  it("faixa em reais por mês, com separador de milhar pt-BR e travessão", () =>
    expect(sal({ salaryMin: 14000, salaryMax: 18000, salaryCurrency: "BRL", salaryPeriod: "month" })).toBe(
      "R$ 14.000 – 18.000 / mês",
    ));

  it("rótulos de período: mês, ano e hora", () => {
    expect(sal({ salaryMin: 1, salaryMax: 2, salaryCurrency: "BRL", salaryPeriod: "year" })).toBe("R$ 1 – 2 / ano");
    expect(sal({ salaryMin: 50, salaryMax: 80, salaryCurrency: "BRL", salaryPeriod: "hour" })).toBe("R$ 50 – 80 / hora");
  });

  it("prefixos de moeda: BRL, USD, EUR e, para o resto, o código ISO", () => {
    expect(sal({ salaryMin: 100, salaryMax: 200, salaryCurrency: "USD", salaryPeriod: "hour" })).toBe("US$ 100 – 200 / hora");
    expect(sal({ salaryMin: 3000, salaryMax: 4000, salaryCurrency: "EUR", salaryPeriod: "month" })).toBe("€ 3.000 – 4.000 / mês");
    expect(sal({ salaryMin: 5000, salaryMax: 6000, salaryCurrency: "gbp", salaryPeriod: "month" })).toBe("GBP 5.000 – 6.000 / mês");
  });

  it("só o mínimo: a partir de", () =>
    expect(sal({ salaryMin: 14000, salaryCurrency: "BRL", salaryPeriod: "month" })).toBe("a partir de R$ 14.000 / mês"));

  it("só o máximo: até", () =>
    expect(sal({ salaryMax: 18000, salaryCurrency: "BRL", salaryPeriod: "month" })).toBe("até R$ 18.000 / mês"));

  it("mínimo igual ao máximo: valor único", () =>
    expect(sal({ salaryMin: 120000, salaryMax: 120000, salaryCurrency: "USD", salaryPeriod: "year" })).toBe(
      "US$ 120.000 / ano",
    ));

  it("sem período e sem moeda: omite só o que falta", () => {
    expect(sal({ salaryMax: 5000, salaryCurrency: "chf" })).toBe("até CHF 5.000");
    expect(sal({ salaryMin: 5000, salaryMax: 6000 })).toBe("5.000 – 6.000");
  });

  it("arredonda centavos", () =>
    expect(sal({ salaryMin: 1234.56, salaryMax: 2000.4, salaryCurrency: "BRL", salaryPeriod: "month" })).toBe(
      "R$ 1.235 – 2.000 / mês",
    ));
});
