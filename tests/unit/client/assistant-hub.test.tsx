import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantHub } from "@/components/profile/assistant/AssistantHub";

afterEach(cleanup);

function hub(over: Partial<Parameters<typeof AssistantHub>[0]> = {}) {
  const props = {
    headlineEmpty: false,
    summaryEmpty: false,
    firstExpId: "exp_1" as string | null,
    firstExpEmpty: false,
    onField: vi.fn(),
    onExperience: vi.fn(),
    ...over,
  };
  render(<AssistantHub {...props} />);
  return props;
}

describe("AssistantHub", () => {
  it("mostra os três atalhos com Escrever/Melhorar conforme o campo", () => {
    hub({ headlineEmpty: true, summaryEmpty: false });
    expect(screen.getByRole("button", { name: "Escrever o título com IA" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Melhorar o resumo com IA" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Melhorar a experiência mais recente com IA" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Assistente de IA" })).toBeTruthy();
  });

  it("clicar em Título chama onField('headline')", () => {
    const p = hub();
    fireEvent.click(screen.getByRole("button", { name: "Melhorar o título com IA" }));
    expect(p.onField).toHaveBeenCalledWith("headline");
  });

  it("clicar em Resumo chama onField('summary')", () => {
    const p = hub();
    fireEvent.click(screen.getByRole("button", { name: "Melhorar o resumo com IA" }));
    expect(p.onField).toHaveBeenCalledWith("summary");
  });

  it("clicar em experiências chama onExperience com o id", () => {
    const p = hub();
    fireEvent.click(screen.getByRole("button", { name: "Melhorar a experiência mais recente com IA" }));
    expect(p.onExperience).toHaveBeenCalledWith("exp_1");
  });

  it("com firstExpId null, o atalho de experiências fica desabilitado e explica", () => {
    hub({ firstExpId: null });
    expect((screen.getByRole("button", { name: "Melhorar a experiência mais recente com IA" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Adicione uma experiência para usar o assistente nela.")).toBeTruthy();
  });
  it("experiência mais recente sem realizações: o atalho vira Escrever", () => {
    const p = hub({ firstExpEmpty: true });
    fireEvent.click(screen.getByRole("button", { name: "Escrever a experiência mais recente com IA" }));
    expect(p.onExperience).toHaveBeenCalledWith("exp_1");
    expect(screen.queryByRole("button", { name: "Melhorar a experiência mais recente com IA" })).toBeNull();
  });

  it("o botão desabilitado aponta para a explicação com aria-describedby", () => {
    hub({ firstExpId: null });
    const btn = screen.getByRole("button", { name: "Melhorar a experiência mais recente com IA" });
    expect(btn).toHaveProperty("disabled", true);
    const id = btn.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe("Adicione uma experiência para usar o assistente nela.");
  });

  it("com experiência, o botão não tem aria-describedby", () => {
    hub();
    expect(screen.getByRole("button", { name: "Melhorar a experiência mais recente com IA" }).hasAttribute("aria-describedby")).toBe(false);
  });
  it("os atalhos quebram linha dentro do card (sem whitespace-nowrap)", () => {
    hub();
    for (const b of screen.getAllByRole("button")) {
      expect(b.className).toContain("max-w-full");
      expect(b.className).toContain("whitespace-normal");
      expect(b.className).toContain("text-left");
      expect(b.className).toContain("h-auto");
      expect(b.className).toContain("min-h-11");
      expect(b.className).not.toContain("whitespace-nowrap");
    }
  });
});
