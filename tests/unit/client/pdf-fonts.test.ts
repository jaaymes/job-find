// @vitest-environment node
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PDF_FAMILIES, PDF_FONT } from "@/lib/client/pdf/fonts";

const FONTS = resolve(import.meta.dirname, "../../../public/fonts");
const NEW_FAMILIES = ["Source Serif 4", "Source Sans 3", "IBM Plex Sans"] as const;

describe("fontes do PDF", () => {
  it("mantém a Inter como fonte padrão", () => {
    expect(PDF_FONT).toBe("Inter");
    expect(Object.keys(PDF_FAMILIES)).toEqual(["Inter", ...NEW_FAMILIES]);
  });

  it("cada arquivo e licença de PDF_FAMILIES existe em public/fonts", () => {
    for (const f of Object.values(PDF_FAMILIES)) {
      for (const file of [f.regular, f.bold, f.license]) {
        expect(existsSync(resolve(FONTS, file)), file).toBe(true);
      }
    }
  });

  it("as 6 fontes novas somam no máximo 1,5 MB", () => {
    const total = NEW_FAMILIES.flatMap((n) => [PDF_FAMILIES[n].regular, PDF_FAMILIES[n].bold]).reduce(
      (sum, file) => sum + statSync(resolve(FONTS, file)).size,
      0,
    );
    expect(total).toBeLessThanOrEqual(1_572_864);
  });
});
