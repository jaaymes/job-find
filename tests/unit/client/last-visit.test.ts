import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import {
  isNewSince,
  lastVisitStore,
  resetPreviousVisitForTests,
  usePreviousVisit,
  useRecordVisit,
} from "@/lib/client/jobs/last-visit";

const KEY = "jobfind:v1:lastVisit";
const ISO = "2026-11-20T12:00:00.000Z";

beforeEach(() => {
  localStorage.clear();
  resetPreviousVisitForTests();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("lastVisitStore", () => {
  it("começa nulo, grava e lê o ISO", () => {
    expect(lastVisitStore.get()).toBeNull();
    lastVisitStore.set(ISO);
    expect(lastVisitStore.get()).toBe(ISO);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ v: 1, data: ISO });
  });

  it("valor que não é data ISO é descartado", () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, data: "ontem" }));
    expect(lastVisitStore.get()).toBeNull();
    localStorage.setItem(KEY, JSON.stringify({ v: 1, data: 123 }));
    expect(lastVisitStore.get()).toBeNull();
  });
});

describe("isNewSince", () => {
  const prev = Date.parse(ISO);
  it("só é nova a vaga publicada depois da visita anterior", () => {
    expect(isNewSince("2026-11-20T12:00:01.000Z", prev)).toBe(true);
    expect(isNewSince(ISO, prev)).toBe(false);
    expect(isNewSince("2026-11-19T00:00:00.000Z", prev)).toBe(false);
  });
  it("primeira visita: nada é nova", () => {
    expect(isNewSince("2026-11-23T00:00:00.000Z", null)).toBe(false);
  });
});

describe("usePreviousVisit", () => {
  it("devolve a visita anterior e a mantém fixa mesmo depois de nova gravação", () => {
    lastVisitStore.set(ISO);
    const { result, rerender } = renderHook(() => usePreviousVisit());
    expect(result.current).toBe(Date.parse(ISO));
    lastVisitStore.set("2026-11-23T00:00:00.000Z");
    rerender();
    expect(result.current).toBe(Date.parse(ISO));
  });

  it("primeira visita: null", () => {
    const { result } = renderHook(() => usePreviousVisit());
    expect(result.current).toBeNull();
  });
});

describe("useRecordVisit", () => {
  const hide = (state: "hidden" | "visible") => {
    Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  it("não grava ao montar", () => {
    renderHook(() => useRecordVisit());
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("grava a hora atual no pagehide", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T10:00:00.000Z"));
    renderHook(() => useRecordVisit());
    window.dispatchEvent(new Event("pagehide"));
    expect(lastVisitStore.get()).toBe("2026-11-23T10:00:00.000Z");
  });

  it("grava quando a aba fica oculta, mas não quando volta a ficar visível", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T10:00:00.000Z"));
    renderHook(() => useRecordVisit());
    hide("visible");
    expect(localStorage.getItem(KEY)).toBeNull();
    hide("hidden");
    expect(lastVisitStore.get()).toBe("2026-11-23T10:00:00.000Z");
    hide("visible");
  });

  it("grava ao desmontar (navegação interna), adiado para depois do StrictMode", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-23T10:00:00.000Z"));
    const { unmount } = renderHook(() => useRecordVisit());
    unmount();
    expect(localStorage.getItem(KEY)).toBeNull();
    vi.runAllTimers();
    expect(lastVisitStore.get()).toBe("2026-11-23T10:00:00.000Z");
  });

  it("montar de novo logo após desmontar (StrictMode) cancela a gravação", () => {
    vi.useFakeTimers();
    const first = renderHook(() => useRecordVisit());
    first.unmount();
    renderHook(() => useRecordVisit());
    vi.runAllTimers();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("depois de desmontar, o pagehide já não grava", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useRecordVisit());
    unmount();
    vi.runAllTimers();
    localStorage.clear();
    window.dispatchEvent(new Event("pagehide"));
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
