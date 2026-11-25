import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  clearSavedSearch,
  hasFilterParams,
  lastFiltersStore,
  useRememberFilters,
  readLastFilters,
  readSavedSearch,
  saveSearch,
  savedFiltersStore,
  toSavedFilters,
} from "@/lib/client/jobs/saved-search";
import type { PageFilters } from "@/lib/client/jobs/use-jobs";

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
    const saved = toSavedFilters({ q: "dev", cursor: "abc", limit: 90 } as PageFilters);
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

describe("useRememberFilters", () => {
  const LAST_KEY = "jobfind:v1:lastFilters";
  const seed = JSON.stringify({ v: 1, data: { filters: { lang: "en" }, savedAt: "2026-01-01T00:00:00.000Z" } });

  it("não grava antes de ready", () => {
    localStorage.setItem(LAST_KEY, seed);
    renderHook(() => useRememberFilters({}, false));
    expect(localStorage.getItem(LAST_KEY)).toBe(seed);
  });

  it("grava sem showHidden", () => {
    renderHook(() => useRememberFilters({ lang: "pt", showHidden: true }, true));
    expect(lastFiltersStore.get()?.filters).toEqual({ lang: "pt" });
  });

  it("filtros vazios gravam null", () => {
    localStorage.setItem(LAST_KEY, seed);
    renderHook(() => useRememberFilters({}, true));
    expect(lastFiltersStore.get()).toBeNull();
    expect(JSON.parse(localStorage.getItem(LAST_KEY)!)).toEqual({ v: 1, data: null });
  });

  it("filtros só com showHidden não apagam a última busca salva", () => {
    localStorage.setItem(LAST_KEY, JSON.stringify({ v: 1, data: { filters: { lang: "en" }, savedAt: new Date().toISOString() } }));
    renderHook(() => useRememberFilters({ showHidden: true } satisfies PageFilters, true));
    expect(lastFiltersStore.get()?.filters).toEqual({ lang: "en" });
  });

  it("renova savedAt expirado quando os filtros mudam de verdade", () => {
    localStorage.setItem(LAST_KEY, seed);
    renderHook(() => useRememberFilters({ lang: "pt" } satisfies PageFilters, true));
    const last = lastFiltersStore.get();
    expect(last?.filters).toEqual({ lang: "pt" });
    expect(Date.parse(last!.savedAt)).toBeGreaterThan(Date.parse("2026-01-02T00:00:00.000Z"));
  });

  it("não regrava savedAt se os filtros não mudaram", () => {
    const { rerender } = renderHook(({ f }) => useRememberFilters(f, true), { initialProps: { f: { lang: "pt" } satisfies PageFilters as PageFilters } });
    const first = lastFiltersStore.get()?.savedAt;
    expect(first).toBeDefined();
    rerender({ f: { lang: "pt" } satisfies PageFilters as PageFilters });
    expect(lastFiltersStore.get()?.savedAt).toBe(first);
  });
});

describe("validade da última busca (7 dias)", () => {
  afterEach(() => vi.useRealTimers());
  const NOW = Date.parse("2026-06-10T12:00:00.000Z");
  const DAYMS = 7 * 24 * 60 * 60 * 1000;
  const seedAt = (ms: number) =>
    lastFiltersStore.set({ filters: { lang: "pt" }, savedAt: new Date(NOW - ms).toISOString() });

  it("exatamente 7 dias ainda é fresca", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    seedAt(DAYMS);
    expect(readLastFilters()).toEqual({ lang: "pt" });
  });

  it("7 dias + 1 ms já expirou", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    seedAt(DAYMS + 1);
    expect(readLastFilters()).toBeNull();
  });
});
