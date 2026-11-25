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
  it("mostra o apoio ao projeto logo depois de Configurações", () => {
    render(<SiteHeader />);
    const links = within(screen.getByRole("navigation", { name: "Principal" })).getAllByRole("link");
    const labels = links.map((link) => link.textContent);
    expect(labels.slice(-2)).toEqual(["Configurações", "Apoie"]);
    expect(links.at(-1)!.getAttribute("href")).toBe("/apoie");
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
