import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "@/components/layout/SiteHeader";

// O botão de tema depende do ThemeProvider e tem testes próprios; aqui só interessa a navegação.
vi.mock("@/components/layout/ThemeToggle", () => ({ ThemeToggle: () => null }));

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
});
