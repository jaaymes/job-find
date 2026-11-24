import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingGuide } from "@/components/onboarding/OnboardingGuide";
import { resetStorageProbeForTests } from "@/lib/client/storage/store";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const KEY = "jobfind:v1:onboarding";

describe("OnboardingGuide", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageProbeForTests();
    pathname = "/";
  });
  afterEach(() => cleanup());

  it("abre sozinho na primeira visita e explica que os dados ficam no localStorage", async () => {
    render(<OnboardingGuide />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Bem-vindo ao Job Find");
    expect(dialog.textContent).toContain("localStorage");
    expect(dialog.textContent).toContain("Nada disso é gravado no nosso servidor");
  });

  it("percorre os passos: IA grátis e currículo do LinkedIn, com links para as telas", async () => {
    render(<OnboardingGuide />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    expect(screen.getByRole("dialog").textContent).toContain("Conecte uma IA (grátis)");
    expect(screen.getByRole("link", { name: "Conectar IA" }).getAttribute("href")).toBe("/configuracoes");
    fireEvent.click(screen.getByRole("button", { name: "Próximo" }));
    expect(screen.getByRole("dialog").textContent).toContain("Recomendado: o PDF do seu LinkedIn");
    expect(screen.getByRole("link", { name: "Importar currículo" }).getAttribute("href")).toBe("/perfil");
    fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    expect(JSON.parse(localStorage.getItem(KEY)!).data.seenAt).toEqual(expect.any(String));
  });

  it("pular grava que foi visto e não abre de novo", async () => {
    const { unmount } = render(<OnboardingGuide />);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Pular guia" }));
    expect(localStorage.getItem(KEY)).not.toBeNull();
    unmount();
    render(<OnboardingGuide />);
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("o botão 'Guia de início' reabre o guia já visto", async () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, data: { seenAt: "2026-01-01T00:00:00.000Z" } }));
    render(<OnboardingGuide />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Guia de início" }));
    expect((await screen.findByRole("dialog")).textContent).toContain("Bem-vindo ao Job Find");
  });

  it("não abre sozinho no callback do OAuth", async () => {
    pathname = "/configuracoes/callback";
    render(<OnboardingGuide />);
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
