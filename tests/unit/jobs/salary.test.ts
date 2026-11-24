import { describe, expect, it } from "vitest";
import { formatSalary } from "@/components/jobs/format";

const base = { salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null } as const;

describe("formatSalary", () => {
  it("devolve null sem salário", () => expect(formatSalary(base)).toBeNull());
  it("faixa em reais por mês", () =>
    expect(formatSalary({ salaryMin: 14000, salaryMax: 18000, salaryCurrency: "BRL", salaryPeriod: "month" })).toBe(
      "R$ 14.000 – 18.000 / mês",
    ));
  it("valor único em dólar por ano", () =>
    expect(formatSalary({ salaryMin: 120000, salaryMax: null, salaryCurrency: "USD", salaryPeriod: "year" })).toBe(
      "US$ 120.000 / ano",
    ));
  it("só o máximo, moeda desconhecida e sem período", () =>
    expect(formatSalary({ salaryMin: null, salaryMax: 5000, salaryCurrency: "chf", salaryPeriod: null })).toBe(
      "CHF 5.000",
    ));
});
