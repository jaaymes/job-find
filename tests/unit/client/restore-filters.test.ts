import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

let search = "";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(search) }));

import { useRestoreFilters } from "@/lib/client/jobs/saved-search";

const KEY = "jobfind:v1:savedFilters";
const raw = (data: unknown) => localStorage.setItem(KEY, JSON.stringify({ v: 1, data }));
const LAST_KEY = "jobfind:v1:lastFilters";
const DAY = 24 * 60 * 60 * 1000;
const last = (filters: unknown, savedAt: string) =>
  localStorage.setItem(LAST_KEY, JSON.stringify({ v: 1, data: { filters, savedAt } }));
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

beforeEach(() => {
  localStorage.clear();
  search = "";
});

describe("useRestoreFilters", () => {
  it("URL com filtros: não aplica e já está pronta", () => {
    raw({ lang: "pt" });
    search = "workMode=remote";
    const setFilters = vi.fn();
    const { result } = renderHook(() => useRestoreFilters({ workMode: "remote" }, setFilters));
    expect(setFilters).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(true);
  });

  it("URL vazia e busca válida: aplica e só fica pronta quando a URL reflete os filtros", () => {
    raw({ lang: "pt", stacks: ["react"] });
    const setFilters = vi.fn();
    const { result, rerender } = renderHook(({ f }) => useRestoreFilters(f, setFilters), {
      initialProps: { f: {} as Record<string, unknown> },
    });
    expect(setFilters).toHaveBeenCalledWith({ lang: "pt", stacks: ["react"] });
    expect(result.current.ready).toBe(false);
    rerender({ f: { lang: "pt" } });
    expect(result.current.ready).toBe(true);
    // Limpar os filtros depois não os reaplica nem trava a consulta.
    rerender({ f: {} });
    expect(setFilters).toHaveBeenCalledTimes(1);
    expect(result.current.ready).toBe(true);
  });

  it("busca inválida ou vazia é descartada: nada é aplicado e já está pronta", () => {
    for (const bad of [{ workMode: "inexistente" }, {}]) {
      raw(bad);
      const setFilters = vi.fn();
      const { result } = renderHook(() => useRestoreFilters({}, setFilters));
      expect(setFilters).not.toHaveBeenCalled();
      expect(result.current.ready).toBe(true);
    }
  });

  it("sem busca padrão: pronta de imediato", () => {
    const setFilters = vi.fn();
    const { result } = renderHook(() => useRestoreFilters({}, setFilters));
    expect(setFilters).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(true);
  });

  it("URL com filtros vence a última busca", () => {
    last({ lang: "pt" }, ago(0));
    search = "workMode=remote";
    const setFilters = vi.fn();
    const { result } = renderHook(() => useRestoreFilters({ workMode: "remote" }, setFilters));
    expect(setFilters).not.toHaveBeenCalled();
    expect(result.current.restored).toBeNull();
  });

  it("última busca recente vence a busca padrão", () => {
    raw({ lang: "en" });
    last({ lang: "pt" }, ago(1000));
    const setFilters = vi.fn();
    const { result } = renderHook(() => useRestoreFilters({}, setFilters));
    expect(setFilters).toHaveBeenCalledWith({ lang: "pt" });
    expect(result.current.restored).toBe("last");
  });

  it("última busca com mais de 7 dias é ignorada e cai na busca padrão", () => {
    raw({ lang: "en" });
    last({ lang: "pt" }, ago(7 * DAY + 1));
    const setFilters = vi.fn();
    const { result } = renderHook(() => useRestoreFilters({}, setFilters));
    expect(setFilters).toHaveBeenCalledWith({ lang: "en" });
    expect(result.current.restored).toBe("saved");
  });

  it("última busca corrompida é ignorada", () => {
    raw({ lang: "en" });
    last({ workMode: "x" }, "ontem");
    const setFilters = vi.fn();
    const { result } = renderHook(() => useRestoreFilters({}, setFilters));
    expect(setFilters).toHaveBeenCalledWith({ lang: "en" });
    expect(result.current.restored).toBe("saved");
  });
});
