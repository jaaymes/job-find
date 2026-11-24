import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChanceBadge } from "@/components/jobs/ChanceBadge";
import { formatAge, formatCollectedAt, isStale, placeLabel } from "@/components/jobs/format";

describe("ChanceBadge", () => {
  it("sem faixa convida a importar o currículo", () => {
    expect(renderToStaticMarkup(<ChanceBadge band={null} />)).toContain("Importe seu currículo para ver");
  });

  it("sem faixa o convite é um link para /perfil com alvo de toque de 44px", () => {
    const html = renderToStaticMarkup(<ChanceBadge band={null} />);
    expect(html).toMatch(/<a [^>]*href="\/perfil"/);
    expect(html).toContain("min-h-11");
  });

  it.each([
    ["alta", "bg-jf-alta text-white", "Alta · 86%"],
    ["media", "bg-jf-media-bg text-jf-media-fg", "Média · 86%"],
    ["baixa", "bg-jf-baixa-bg text-jf-baixa-fg", "Baixa · 86%"],
  ] as const)("faixa %s usa as cores do protótipo", (band, classes, text) => {
    const html = renderToStaticMarkup(<ChanceBadge band={band} score={86} />);
    expect(html).toContain(classes);
    expect(html).toContain(text);
  });
});

describe("tokens de cor do protótipo", () => {
  it("globals.css define os hex exatos das faixas", async () => {
    const { readFile } = await import("node:fs/promises");
    const css = (await readFile("app/globals.css", "utf8")).toLowerCase();
    for (const hex of ["#0b6b5c", "#e3f1ee", "#0a5a4d", "#eeedea", "#4a4f5a"]) expect(css).toContain(hex);
  });
});

describe("format", () => {
  const now = Date.parse("2026-11-23T15:00:00Z");
  it("formatAge", () => {
    expect(formatAge("2026-11-23T14:37:00Z", now)).toBe("há 23 min");
    expect(formatAge("2026-11-23T12:30:00Z", now)).toBe("há 2 h");
    expect(formatAge("2026-11-22T10:00:00Z", now)).toBe("há 1 dia");
    expect(formatAge("2026-11-20T10:00:00Z", now)).toBe("há 3 dias");
  });
  it("isStale: só com data e mais de 3 h", () => {
    expect(isStale(null, now)).toBe(false);
    expect(isStale("2026-11-23T12:30:00Z", now)).toBe(false);
    expect(isStale("2026-11-23T11:59:00Z", now)).toBe(true);
  });
  it("formatCollectedAt usa America/Sao_Paulo", () => {
    expect(formatCollectedAt("2026-11-23T13:15:00Z")).toEqual({ time: "10:15", date: "23/11/2026" });
  });
  it("placeLabel", () => {
    expect(placeLabel({ city: "São Paulo", country: "BR", acceptsBrazil: true, origin: "national" })).toBe("São Paulo, BR");
    expect(placeLabel({ city: null, country: "US", acceptsBrazil: true, origin: "international" })).toBe("US · aceita Brasil");
    expect(placeLabel({ city: null, country: null, acceptsBrazil: null, origin: "unknown" })).toBe("Local não informado");
  });
});
