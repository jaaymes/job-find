import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { jobStateStore, type JobState } from "@/lib/client/jobs/job-state";
import { ThemeProvider } from "@/lib/client/theme/ThemeProvider";
import { THEME_STORAGE_KEY } from "@/lib/shared/theme-script";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
// O guia de onboarding depende do roteador e tem testes próprios.
vi.mock("@/components/onboarding/OnboardingGuide", () => ({
  OnboardingGuide: ({ triggerClassName }: { triggerClassName?: string }) => (
    <button type="button" className={triggerClassName}>
      Guia de início
    </button>
  ),
}));

function stubMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

function jobState(id: number, favorite: boolean, status: JobState["status"] = "none"): JobState {
  return {
    favorite,
    hidden: false,
    status,
    statusHistory: [],
    snapshot: {
      id,
      title: "Dev",
      company: "Acme",
      urlCanonical: null,
      stacks: [],
      workMode: "remote",
      publishedAt: "2026-01-01T00:00:00Z",
    },
  };
}

function renderBar(current?: Parameters<typeof MobileTabBar>[0]["current"]) {
  return render(
    <ThemeProvider>
      <MobileTabBar current={current} />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  stubMatchMedia();
  localStorage.clear();
  jobStateStore.set({});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MobileTabBar", () => {
  it("renderiza 4 abas com aria-current na rota atual", () => {
    renderBar("perfil");
    const nav = screen.getByRole("navigation", { name: "Navegação inferior" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Vagas", "Minhas vagas", "Perfil"]);
    expect(within(nav).getByRole("button", { name: "Mais" })).toBeTruthy();
    expect(within(nav).getByRole("link", { name: "Perfil" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: "Vagas" }).getAttribute("aria-current")).toBeNull();
  });

  it("Minhas vagas conta só a etapa Salvas (status Salva ou favorita sem status)", () => {
    act(() =>
      jobStateStore.set({
        "1": jobState(1, true),
        "2": jobState(2, false, "saved"),
        "3": jobState(3, false),
        "4": jobState(4, true, "applied"),
      }),
    );
    renderBar();
    const link = screen.getByRole("link", { name: /Minhas vagas/ });
    expect(within(link).getByText("2")).toBeTruthy();
  });

  it("Mais abre sheet com os atalhos e o seletor de tema", () => {
    renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Mais" }));
    const dialog = screen.getByRole("dialog", { name: "Mais" });
    for (const name of [/Configurações de IA/, /Dados e backup/, /Fontes de vagas/, /Apoie o projeto/, /Privacidade/]) {
      expect(within(dialog).getByRole("link", { name })).toBeTruthy();
    }
    expect(within(dialog).getByRole("button", { name: "Guia de início" })).toBeTruthy();
    const group = within(dialog).getByRole("radiogroup", { name: "Tema" });
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Claro", "Escuro", "Sistema"]);
    expect(within(group).getByRole("radio", { name: "Sistema" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(group).getByRole("radio", { name: "Escuro" }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(within(group).getByRole("radio", { name: "Escuro" }).getAttribute("aria-checked")).toBe("true");
  });

  it("barra recebe classe que a oculta quando um campo de texto tem foco", () => {
    renderBar();
    const nav = screen.getByRole("navigation", { name: "Navegação inferior" });
    expect(nav.className).toContain("[body:has(input:focus,textarea:focus)_&]:hidden");
    expect(nav.className).toContain("md:hidden");
  });
});
