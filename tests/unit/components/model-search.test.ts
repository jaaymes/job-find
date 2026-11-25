import { describe, expect, it } from "vitest";
import { matchesModel, optionKey, type ModelOption } from "@/components/settings/model-search";

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
});
