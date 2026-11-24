import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

let search = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search) }));

import { useApplySavedSearch } from "@/lib/client/jobs/saved-search";

const KEY = "jobfind:v1:savedFilters";
const raw = (data: unknown) => localStorage.setItem(KEY, JSON.stringify({ v: 1, data }));

beforeEach(() => {
  localStorage.clear();
  search = "";
});

describe("useApplySavedSearch", () => {
  it("URL com filtros: não aplica e já está pronta", () => {
    raw({ lang: "pt" });
    search = "workMode=remote";
    const setFilters = vi.fn();
    const { result } = renderHook(() => useApplySavedSearch({ workMode: "remote" }, setFilters));
    expect(setFilters).not.toHaveBeenCalled();
    expect(result.current).toBe(true);
  });

  it("URL vazia e busca válida: aplica e só fica pronta quando a URL reflete os filtros", () => {
    raw({ lang: "pt", stacks: ["react"] });
    const setFilters = vi.fn();
    const { result, rerender } = renderHook(({ f }) => useApplySavedSearch(f, setFilters), {
      initialProps: { f: {} as Record<string, unknown> },
    });
    expect(setFilters).toHaveBeenCalledWith({ lang: "pt", stacks: ["react"] });
    expect(result.current).toBe(false);
    rerender({ f: { lang: "pt" } });
    expect(result.current).toBe(true);
    // Limpar os filtros depois não os reaplica nem trava a consulta.
    rerender({ f: {} });
    expect(setFilters).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(true);
  });

  it("busca inválida ou vazia é descartada: nada é aplicado e já está pronta", () => {
    for (const bad of [{ workMode: "inexistente" }, {}]) {
      raw(bad);
      const setFilters = vi.fn();
      const { result } = renderHook(() => useApplySavedSearch({}, setFilters));
      expect(setFilters).not.toHaveBeenCalled();
      expect(result.current).toBe(true);
    }
  });

  it("sem busca padrão: pronta de imediato", () => {
    const setFilters = vi.fn();
    const { result } = renderHook(() => useApplySavedSearch({}, setFilters));
    expect(setFilters).not.toHaveBeenCalled();
    expect(result.current).toBe(true);
  });
});
