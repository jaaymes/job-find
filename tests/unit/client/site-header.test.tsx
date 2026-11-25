import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "@/components/layout/SiteHeader";
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
