import { describe, expect, it } from "vitest";
import { buildJobsUrl } from "@/lib/shared/jobs-url";
import { parseJobsQuery } from "@/lib/shared/schemas/jobs-query";
import { decodeCursor, encodeCursor } from "@/lib/server/jobs/cursor";

describe("buildJobsUrl", () => {
  it("ordena arrays e omite valores padrão", () => {
    expect(buildJobsUrl({ stacks: ["vue", "react"], stacksMode: "any", limit: 30 })).toBe(
      "/api/jobs?stacks=react%2Cvue",
    );
  });

  it("sem filtros devolve só o caminho", () => {
    expect(buildJobsUrl({})).toBe("/api/jobs");
  });

  it("ordena as chaves alfabeticamente e mantém não padrões", () => {
    expect(
      buildJobsUrl({ workMode: "remote", stacksMode: "all", limit: 60, origin: "national" }),
    ).toBe("/api/jobs?limit=60&origin=national&stacksMode=all&workMode=remote");
  });

  it("emite acceptsBrazil false e ignora listas vazias", () => {
    expect(buildJobsUrl({ acceptsBrazil: false, seniority: [] })).toBe(
      "/api/jobs?acceptsBrazil=false",
    );
  });

  it("é inverso de parseJobsQuery", () => {
    const url = buildJobsUrl({ q: "c#", stacks: ["vue", "react"], source: ["lever", "ashby"] });
    const r = parseJobsQuery(new URL(url, "http://x").searchParams);
    expect(r).toEqual({
      ok: true,
      value: { q: "c#", stacks: ["react", "vue"], source: ["ashby", "lever"], stacksMode: "any", limit: 30 },
    });
  });
});

describe("cursor", () => {
  it("faz round-trip", () => {
    const c = { publishedAt: new Date("2026-06-01T12:00:00.123Z"), id: 42 };
    const s = encodeCursor(c);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(s)).toEqual(c);
  });

  it("devolve null para lixo", () => {
    expect(decodeCursor("lixo")).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor(Buffer.from("x|y").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("2026-06-01T00:00:00.000Z|1.5").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from("2026-06-01T00:00:00.000Z|-1").toString("base64url"))).toBeNull();
  });
});
