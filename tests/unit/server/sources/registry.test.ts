import { describe, expect, it } from "vitest";
import { SOURCE_IDS } from "@/lib/shared/sources";
import { CONNECTORS } from "@/lib/server/sources/registry";

describe("registry de conectores", () => {
  it("cada conector registrado tem o id da própria chave e cobre o catálogo", () => {
    expect(Object.keys(CONNECTORS).sort()).toEqual([...SOURCE_IDS].sort());
    for (const [key, c] of Object.entries(CONNECTORS)) expect(c.id).toBe(key);
  });
});
