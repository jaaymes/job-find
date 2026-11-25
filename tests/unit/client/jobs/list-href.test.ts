import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consumeListReturn, markListReturn, useJobsListHref } from "@/lib/client/jobs/list-href";
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
  it("markListReturn(5) e consumeListReturn(5) devolve true uma única vez", () => {
    markListReturn(5);
    expect(consumeListReturn(5)).toBe(true);
    expect(consumeListReturn(5)).toBe(false);
  });

  it("consumeListReturn de outra vaga devolve false", () => {
    markListReturn(5);
    expect(consumeListReturn(6)).toBe(false);
  });
});
