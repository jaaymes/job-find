import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyPixKey } from "@/components/donation/CopyPixKey";
import ApoiePage from "@/app/(site)/apoie/page";
import { SiteFooter } from "@/components/layout/SiteFooter";

vi.mock("@/components/layout/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));

// O guia de boas-vindas tem testes próprios; aqui só interessa o link do rodapé.
vi.mock("@/components/onboarding/OnboardingGuide", () => ({ OnboardingGuide: () => null }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CopyPixKey", () => {
  it("copia o valor e confirma para o leitor de tela", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyPixKey value="chave-123" label="Copiar chave" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copiar chave" }));
    });

    expect(writeText).toHaveBeenCalledWith("chave-123");
    expect(screen.getByRole("status").textContent).toBe("Copiado!");
  });

  it("avisa quando o navegador não deixa copiar", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("negado"));
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CopyPixKey value="chave-123" label="Copiar chave" />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copiar chave" }));
    });

    expect(screen.getByRole("status").textContent).toBe("Não foi possível copiar. Selecione e copie manualmente.");
  });
});

describe("SiteFooter", () => {
  it("leva à página de apoio", () => {
    render(<SiteFooter />);
    expect(screen.getByRole("link", { name: "Apoie o projeto" }).getAttribute("href")).toBe("/apoie");
  });
});

describe("Página Apoie", () => {
  it("no celular mostra Copiar Pix copia e cola antes do QR", async () => {
    render(await ApoiePage());
    const copy = screen.getByRole("button", { name: "Copiar Pix copia e cola" });
    const qr = screen.getByRole("img", { name: "QR code do Pix para apoiar o Job Find" });
    expect(copy.compareDocumentPosition(qr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
