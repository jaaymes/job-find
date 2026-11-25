import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocalRoute, navItemForPath } from "@/components/layout/nav";
import { NavLink } from "@/components/layout/NavLink";

const linkSpy = vi.hoisted(() => vi.fn());
vi.mock("next/link", () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => {
    linkSpy(props);
    return <a data-nextjs-link="" {...props} />;
  },
}));

afterEach(() => {
  cleanup();
  linkSpy.mockClear();
});

describe("isLocalRoute", () => {
  it.each(["/perfil", "/configuracoes", "/minhas-vagas", "/gerador/12"])("%s é local", (href) => {
    expect(isLocalRoute(href)).toBe(true);
  });
  it.each(["/", "/apoie", "/fontes", "/vagas/3"])("%s é público", (href) => {
    expect(isLocalRoute(href)).toBe(false);
  });
});

describe("navItemForPath", () => {
  it("casa por prefixo", () => {
    expect(navItemForPath("/configuracoes/callback")).toBe("configuracoes");
    expect(navItemForPath("/apoie")).toBe("apoie");
  });
  it("devolve undefined fora do menu", () => {
    expect(navItemForPath("/gerador/9")).toBeUndefined();
  });
});

describe("NavLink", () => {
  it("rota local vira <a> comum, sem next/link", () => {
    render(<NavLink href="/perfil">Perfil</NavLink>);
    const a = screen.getByRole("link", { name: "Perfil" });
    expect(a.hasAttribute("data-nextjs-link")).toBe(false);
    expect(linkSpy).not.toHaveBeenCalled();
  });
  it("rota pública usa next/link e marca aria-current", () => {
    render(<NavLink href="/apoie" current>Apoie</NavLink>);
    expect(linkSpy).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Apoie" }).getAttribute("aria-current")).toBe("page");
  });
});
