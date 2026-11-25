import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindListReturn, consumeListReturn, markListReturn, useJobsListHref } from "@/lib/client/jobs/list-href";
import { lastFiltersStore, LAST_FILTERS_TTL_MS } from "@/lib/client/jobs/saved-search";
import { serializeFilters } from "@/lib/client/jobs/use-jobs";

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => cleanup());

describe("useJobsListHref", () => {
  it("sem store, devolve /", () => {
    const { result } = renderHook(() => useJobsListHref());
    expect(result.current).toBe("/");
  });

  it("com a última busca, carrega os filtros na URL", () => {
    const filters = { stacks: ["react", "nodejs"], showHidden: undefined, workMode: "remote" as const };
    lastFiltersStore.set({ filters, savedAt: new Date().toISOString() });
    const { result } = renderHook(() => useJobsListHref());
    expect(result.current).toBe(serializeFilters("/", filters));
    expect(new URL(result.current, "http://x").searchParams.get("stacks")).toBe("react,nodejs");
    expect(new URL(result.current, "http://x").searchParams.get("workMode")).toBe("remote");
  });

  it("com a última busca expirada, devolve /", () => {
    const savedAt = new Date(Date.now() - LAST_FILTERS_TTL_MS - 60_000).toISOString();
    lastFiltersStore.set({ filters: { workMode: "remote" }, savedAt });
    const { result } = renderHook(() => useJobsListHref());
    expect(result.current).toBe("/");
  });

  it("acompanha mudanças da store", () => {
    const { result } = renderHook(() => useJobsListHref());
    expect(result.current).toBe("/");
    act(() => {
      lastFiltersStore.set({ filters: { workMode: "hybrid" }, savedAt: new Date().toISOString() });
    });
    expect(result.current).toBe("/?workMode=hybrid");
  });
});

describe("listReturn", () => {
  const KEY = "jobfind:session:listReturn";
  let length = 3;
  beforeEach(() => {
    length = 3;
    vi.spyOn(window.history, "length", "get").mockImplementation(() => length);
  });
  afterEach(() => vi.restoreAllMocks());

  it("marcada, presa e consumida na mesma entrada devolve true uma única vez", () => {
    markListReturn(5);
    bindListReturn(5);
    expect(JSON.parse(window.sessionStorage.getItem(KEY)!)).toEqual({ jobId: 5, len: 3 });
    expect(consumeListReturn(5)).toBe(true);
    expect(consumeListReturn(5)).toBe(false);
  });

  it("consumeListReturn de outra vaga devolve false", () => {
    markListReturn(5);
    bindListReturn(5);
    expect(consumeListReturn(6)).toBe(false);
  });

  it("bindListReturn não sobrescreve o len já gravado (F5 ou nova visita à vaga)", () => {
    markListReturn(5);
    bindListReturn(5);
    length = 5;
    bindListReturn(5);
    expect(JSON.parse(window.sessionStorage.getItem(KEY)!)).toEqual({ jobId: 5, len: 3 });
  });

  it("bindListReturn de outra vaga não mexe na marca", () => {
    markListReturn(5);
    bindListReturn(6);
    expect(JSON.parse(window.sessionStorage.getItem(KEY)!)).toEqual({ jobId: 5 });
  });

  it("history.length diferente do gravado (houve navegação no meio) devolve false", () => {
    markListReturn(5);
    bindListReturn(5);
    length = 5;
    expect(consumeListReturn(5)).toBe(false);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("history.length === 1 devolve false", () => {
    length = 1;
    markListReturn(5);
    bindListReturn(5);
    expect(consumeListReturn(5)).toBe(false);
  });

  it("marca sem len (formato antigo ou detalhe não montado) devolve false", () => {
    markListReturn(5);
    expect(consumeListReturn(5)).toBe(false);
  });

  it("marca corrompida devolve false e é removida", () => {
    window.sessionStorage.setItem(KEY, "{nope");
    bindListReturn(5);
    expect(consumeListReturn(5)).toBe(false);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("sessionStorage lançando devolve false sem quebrar", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(() => markListReturn(5)).not.toThrow();
    expect(() => bindListReturn(5)).not.toThrow();
    expect(consumeListReturn(5)).toBe(false);
  });
});
