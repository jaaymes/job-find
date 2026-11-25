import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { aiSettingsStore, defaultAiSettings } from "@/lib/client/ai/settings";
import { SiteFooter } from "@/components/layout/SiteFooter";

// O botão de tema depende do ThemeProvider e tem testes próprios; aqui só interessa a navegação.
vi.mock("@/components/layout/ThemeToggle", () => ({ ThemeToggle: () => null }));

// O guia de onboarding depende do roteador e tem testes próprios.
vi.mock("@/components/onboarding/OnboardingGuide", () => ({ OnboardingGuide: () => null }));

afterEach(() => cleanup());

describe("SiteHeader", () => {
  it("mantém o apoio fora do menu principal, como link discreto à direita", () => {
    render(<SiteHeader />);
    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Vagas",
      "Minhas vagas",
      "Perfil",
      "Configurações",
    ]);
    expect(within(nav).queryByRole("link", { name: "Apoie" })).toBeNull();
    expect(screen.getByRole("link", { name: "Apoie" }).getAttribute("href")).toBe("/apoie");
  });

  it("mostra o estado do setup no header: IA conectada e currículo pendente", () => {
    localStorage.clear();
    aiSettingsStore.set({
      ...defaultAiSettings(),
      providers: { openrouter: { key: "k", addedAt: "2026-01-01", source: "paste" as const } },
    });
    render(<SiteHeader />);
    const status = screen.getByRole("link", { name: "IA conectada · Currículo pendente" });
    expect(status.getAttribute("href")).toBe("/perfil");
    expect(status.className).toContain("lg:inline-flex");
    localStorage.clear();
  });

  it("destaca o item na página de apoio", () => {
    render(<SiteHeader current="apoie" />);
    expect(screen.getByRole("link", { name: "Apoie" }).getAttribute("aria-current")).toBe("page");
  });

  it("links do rodapé têm min-h-11", () => {
    render(<SiteFooter />);
    const footer = screen.getByRole("contentinfo");
    for (const name of ["Fontes", "Privacidade", "Apoie o projeto", "Código no GitHub"]) {
      expect(within(footer).getByRole("link", { name }).className).toContain("min-h-11");
    }
  });
});
