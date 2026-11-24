import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "@/lib/client/theme/ThemeProvider";
import { THEME_STORAGE_KEY } from "@/lib/shared/theme-script";

type Listener = (e: { matches: boolean }) => void;

/** jsdom não tem matchMedia: este stub controla o "sistema" e conta os ouvintes. */
function stubMatchMedia(initialDark: boolean) {
  const listeners = new Set<Listener>();
  const mql = {
    matches: initialDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: "change", l: Listener) => listeners.add(l),
    removeEventListener: (_: "change", l: Listener) => listeners.delete(l),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => mql));
  return {
    listeners,
    setDark(dark: boolean) {
      mql.matches = dark;
      for (const l of [...listeners]) l({ matches: dark });
    },
  };
}

const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider>{children}</ThemeProvider>;
const html = () => document.documentElement;

describe("ThemeProvider / useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    html().classList.remove("dark");
    html().style.colorScheme = "";
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("sem preferência salva segue o sistema", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.pref).toBe("system");
    expect(result.current.resolved).toBe("dark");
    expect(html().classList.contains("dark")).toBe(true);
    expect(html().style.colorScheme).toBe("dark");
  });

  it("lê a preferência salva", () => {
    stubMatchMedia(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.pref).toBe("dark");
    expect(result.current.resolved).toBe("dark");
    expect(html().classList.contains("dark")).toBe(true);
  });

  it("valor salvo inválido vira 'system'", () => {
    stubMatchMedia(false);
    localStorage.setItem(THEME_STORAGE_KEY, "roxo");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.pref).toBe("system");
    expect(result.current.resolved).toBe("light");
  });

  it("setPref('light') grava em localStorage e tira .dark", () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(html().classList.contains("dark")).toBe(true);
    act(() => result.current.setPref("light"));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(result.current.pref).toBe("light");
    expect(result.current.resolved).toBe("light");
    expect(html().classList.contains("dark")).toBe(false);
    expect(html().style.colorScheme).toBe("light");
  });

  it("localStorage que lança não quebra: usa o sistema", () => {
    stubMatchMedia(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("x", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("x", "SecurityError");
    });
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.pref).toBe("system");
    expect(result.current.resolved).toBe("dark");
    act(() => result.current.setPref("light"));
    expect(result.current.pref).toBe("light");
    expect(html().classList.contains("dark")).toBe(false);
  });

  it("muda junto com o sistema quando pref é 'system'", () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.resolved).toBe("light");
    act(() => media.setDark(true));
    expect(result.current.resolved).toBe("dark");
    expect(html().classList.contains("dark")).toBe(true);
    act(() => media.setDark(false));
    expect(result.current.resolved).toBe("light");
    expect(html().classList.contains("dark")).toBe(false);
  });

  it("com pref fixa não escuta o sistema", () => {
    const media = stubMatchMedia(false);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(media.listeners.size).toBe(0);
    act(() => media.setDark(true));
    expect(result.current.resolved).toBe("light");
    expect(html().classList.contains("dark")).toBe(false);
    act(() => result.current.setPref("system"));
    expect(media.listeners.size).toBe(1);
    expect(result.current.resolved).toBe("dark");
  });

  it("sem matchMedia no navegador cai no claro", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.resolved).toBe("light");
  });

  it("renderiza os filhos", () => {
    stubMatchMedia(false);
    render(<ThemeProvider><p>conteúdo</p></ThemeProvider>);
    expect(screen.getByText("conteúdo")).toBeTruthy();
  });

  it("useTheme fora do provider lança um erro claro", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useTheme())).toThrow("useTheme precisa estar dentro de <ThemeProvider>");
  });
});

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    html().classList.remove("dark");
    html().style.colorScheme = "";
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("ThemeToggle alterna e expõe o estado", async () => {
    stubMatchMedia(false);
    const { ThemeToggle } = await import("@/components/layout/ThemeToggle");
    render(<ThemeToggle />, { wrapper });
    const toDark = screen.getByRole("button", { name: "Ativar tema escuro" });
    expect(toDark.getAttribute("type")).toBe("button");
    expect(toDark.getAttribute("aria-pressed")).toBe("false");
    act(() => toDark.click());
    const toLight = screen.getByRole("button", { name: "Ativar tema claro" });
    expect(toLight.getAttribute("aria-pressed")).toBe("true");
    expect(html().classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    act(() => toLight.click());
    expect(screen.getByRole("button", { name: "Ativar tema escuro" }).getAttribute("aria-pressed")).toBe("false");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(html().classList.contains("dark")).toBe(false);
  });

  it("no servidor renderiza só um placeholder do mesmo tamanho, sem botão", async () => {
    const { renderToString } = await import("react-dom/server");
    const { ThemeToggle } = await import("@/components/layout/ThemeToggle");
    const out = renderToString(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(out).not.toContain("<button");
    expect(out).toContain("size-11");
  });
});
