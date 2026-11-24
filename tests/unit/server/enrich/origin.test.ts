import { describe, expect, it } from "vitest";
import { classifyOrigin } from "@/lib/server/enrich/origin";

const base = { country: null, locationText: null, eligibleRegions: [], sourceIsBrazilian: false };

describe("classifyOrigin", () => {
  it("país BR é nacional", () => {
    expect(classifyOrigin({ ...base, country: "BR", locationText: "São Paulo" })).toEqual({
      origin: "national",
      acceptsBrazil: true,
    });
  });
  it("remoto LATAM sem país é internacional e aceita Brasil", () => {
    expect(classifyOrigin({ ...base, locationText: "Remote", eligibleRegions: ["LATAM"] })).toEqual({
      origin: "international",
      acceptsBrazil: true,
    });
  });
  it("US only não aceita Brasil", () => {
    expect(
      classifyOrigin({
        ...base,
        country: "US",
        locationText: "Remote - US only",
        eligibleRegions: ["United States"],
      }),
    ).toEqual({ origin: "international", acceptsBrazil: false });
  });
  it("sem informação é unknown", () => {
    expect(classifyOrigin(base)).toEqual({ origin: "unknown", acceptsBrazil: null });
  });
  it("remoto com região Brazil de empresa estrangeira é internacional e aceita Brasil", () => {
    expect(
      classifyOrigin({ ...base, locationText: "Remote", eligibleRegions: ["Brazil"] }),
    ).toEqual({ origin: "international", acceptsBrazil: true });
  });
  it("país estruturado vence o texto", () => {
    expect(classifyOrigin({ ...base, country: "US", locationText: "São Paulo" }).origin).toBe(
      "international",
    );
  });
  it("fonte brasileira é nacional", () => {
    expect(classifyOrigin({ ...base, sourceIsBrazilian: true })).toEqual({
      origin: "national",
      acceptsBrazil: true,
    });
  });
  it("texto com cidade ou estado brasileiro é nacional", () => {
    expect(classifyOrigin({ ...base, locationText: "Curitiba, PR" }).origin).toBe("national");
    expect(classifyOrigin({ ...base, locationText: "Minas Gerais" }).origin).toBe("national");
    expect(classifyOrigin({ ...base, locationText: "Brasil" }).origin).toBe("national");
  });
  it("Worldwide aceita Brasil", () => {
    expect(
      classifyOrigin({ ...base, locationText: "Anywhere", eligibleRegions: ["Worldwide"] }),
    ).toEqual({ origin: "international", acceptsBrazil: true });
  });
  it("texto Europe only não aceita Brasil", () => {
    expect(classifyOrigin({ ...base, locationText: "Remote (Europe only)" })).toEqual({
      origin: "international",
      acceptsBrazil: false,
    });
  });
  it("país estrangeiro sem restrições explícitas é internacional com acceptsBrazil false", () => {
    expect(classifyOrigin({ ...base, country: "DE", locationText: "Berlin" })).toEqual({
      origin: "international",
      acceptsBrazil: false,
    });
  });
  it("fonte brasileira com regiões é nacional", () => {
    expect(
      classifyOrigin({ ...base, sourceIsBrazilian: true, locationText: "Remoto", eligibleRegions: ["Brasil"] }),
    ).toEqual({ origin: "national", acceptsBrazil: true });
    expect(
      classifyOrigin({ ...base, sourceIsBrazilian: true, locationText: "", eligibleRegions: ["LATAM"] }),
    ).toEqual({ origin: "national", acceptsBrazil: true });
  });
  it("fonte estrangeira com LATAM continua internacional", () => {
    expect(
      classifyOrigin({ ...base, locationText: "Remote", eligibleRegions: ["LATAM"] }),
    ).toEqual({ origin: "international", acceptsBrazil: true });
  });
  it("'join us' não é restrição", () => {
    expect(classifyOrigin({ ...base, locationText: "Remote, come join us" }).acceptsBrazil).not.toBe(false);
  });
});
