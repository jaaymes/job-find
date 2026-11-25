import { describe, expect, it } from "vitest";
import { foldQuery, matchesModel, matchesSearchText, optionKey, searchText, type ModelOption } from "@/components/settings/model-search";

const m = (over: Partial<ModelOption> = {}): ModelOption => ({
  id: "google/gemini-flash",
  label: "Gêmini Flash",
  provider: "openrouter",
  ...over,
});

describe("matchesModel", () => {
  it("ignora acento e caixa no nome", () => {
    expect(matchesModel(m(), "gemini", "OpenRouter")).toBe(true);
    expect(matchesModel(m(), "GÊMINI", "OpenRouter")).toBe(true);
  });

  it("acha pelo id", () => {
    expect(matchesModel(m(), "google/", "OpenRouter")).toBe(true);
  });

  it("acha pelo nome do provedor", () => {
    expect(matchesModel(m({ label: "Outro", id: "x/y" }), "openrouter", "OpenRouter")).toBe(true);
    expect(matchesModel(m({ label: "Outro", id: "x/y" }), "anthropic", "OpenRouter")).toBe(false);
  });

  it("query só com espaços acha tudo", () => {
    expect(matchesModel(m(), "   ", "OpenRouter")).toBe(true);
  });

  it("optionKey combina provedor e id", () => {
    expect(optionKey(m({ id: "a", provider: "deepseek" }))).toBe("deepseek:a");
  });

  it("searchText pré-dobra nome, id e provedor; matchesSearchText bate com matchesModel", () => {
    const text = searchText(m(), "OpenRouter");
    expect(text).toBe("gemini flash google/gemini-flash openrouter");
    for (const q of ["gemini", "GÊMINI", "google/", "openrouter", "anthropic", "   "]) {
      expect(matchesSearchText(text, foldQuery(q))).toBe(matchesModel(m(), q, "OpenRouter"));
    }
  });
});
