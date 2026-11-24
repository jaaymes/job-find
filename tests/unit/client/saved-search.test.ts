import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSavedSearch,
  hasFilterParams,
  readSavedSearch,
  saveSearch,
  savedFiltersStore,
  toSavedFilters,
} from "@/lib/client/jobs/saved-search";

const KEY = "jobfind:v1:savedFilters";
const raw = (data: unknown, v = 1) => localStorage.setItem(KEY, JSON.stringify({ v, data }));

beforeEach(() => localStorage.clear());

describe("toSavedFilters", () => {
  it("guarda os filtros, sem ocultas, e solta o padrão stacksMode=any", () => {
    expect(
      toSavedFilters({ stacks: ["react"], stacksMode: "any", workMode: "remote", seniority: ["senior"], showHidden: true }),
    ).toEqual({ stacks: ["react"], workMode: "remote", seniority: ["senior"] });
  });

  it("inclui chance e stacksMode=all", () => {
    expect(toSavedFilters({ stacks: ["react", "vue"], stacksMode: "all", chance: ["alta"] })).toEqual({
      stacks: ["react", "vue"],
      stacksMode: "all",
      chance: ["alta"],
    });
  });

  it("sem filtros (ou só ocultas) não há o que salvar", () => {
    expect(toSavedFilters({})).toBeNull();
    expect(toSavedFilters({ showHidden: true })).toBeNull();
    expect(toSavedFilters({ stacks: [] })).toBeNull();
  });

  it("não carrega cursor nem limit, mesmo que venham no objeto", () => {
    const saved = toSavedFilters({ q: "dev", cursor: "abc", limit: 90 } as never);
    expect(saved).toEqual({ q: "dev" });
  });
});

describe("savedFiltersStore", () => {
  it("começa sem busca padrão", () => {
    expect(savedFiltersStore.get()).toBeNull();
    expect(readSavedSearch()).toBeNull();
  });

  it("salva, lê e limpa", () => {
    expect(saveSearch({ lang: "pt", origin: "national", showHidden: true })).toEqual({ ok: true });
    expect(savedFiltersStore.get()).toEqual({ lang: "pt", origin: "national" });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ v: 1, data: { lang: "pt", origin: "national" } });
    expect(clearSavedSearch()).toEqual({ ok: true });
    expect(readSavedSearch()).toBeNull();
  });

  it("saveSearch sem filtros limpa a busca que existia", () => {
    saveSearch({ lang: "pt" });
    expect(saveSearch({ showHidden: true })).toEqual({ ok: true });
    expect(savedFiltersStore.get()).toBeNull();
  });

  it("objeto inválido é descartado (valor fora do schema, tipo errado, versão futura, JSON quebrado)", () => {
    raw({ workMode: "inexistente" });
    expect(savedFiltersStore.get()).toBeNull();
    raw([1, 2]);
    expect(savedFiltersStore.get()).toBeNull();
    raw({ lang: "pt" }, 2);
    expect(savedFiltersStore.get()).toBeNull();
    localStorage.setItem(KEY, "{quebrado");
    expect(savedFiltersStore.get()).toBeNull();
    expect(readSavedSearch()).toBeNull();
  });

  it("leitura tolerante: campo desconhecido é ignorado, não derruba a busca", () => {
    raw({ lang: "en", intruso: 1 });
    expect(savedFiltersStore.get()).toEqual({ lang: "en" });
  });

  it("objeto vazio gravado não conta como busca padrão", () => {
    raw({});
    expect(readSavedSearch()).toBeNull();
  });
});

describe("hasFilterParams", () => {
  const has = (qs: string) => hasFilterParams(new URLSearchParams(qs));
  it("URL sem parâmetros ou só com parâmetros alheios: sem filtro", () => {
    expect(has("")).toBe(false);
    expect(has("utm_source=x")).toBe(false);
  });
  it("qualquer parâmetro de filtro conta, inclusive ocultas", () => {
    expect(has("q=react")).toBe(true);
    expect(has("workMode=remote")).toBe(true);
    expect(has("ocultas=1")).toBe(true);
    expect(has("stacks=react&utm=1")).toBe(true);
  });
});
