import { describe, expect, it } from "vitest";
import { FILTERABLE_SOURCES } from "@/components/jobs/format";
import { CONNECTORS } from "@/lib/server/sources/registry";

describe("registry de conectores", () => {
  it("o filtro de fonte da UI lista exatamente as fontes com conector registrado", () => {
    expect([...FILTERABLE_SOURCES].sort()).toEqual(Object.keys(CONNECTORS).sort());
  });
});
