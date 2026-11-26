import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssistantHub } from "@/components/profile/assistant/AssistantHub";

afterEach(cleanup);

function hub(over: Partial<Parameters<typeof AssistantHub>[0]> = {}) {
  const props = {
    headlineEmpty: false,
    summaryEmpty: false,
    firstExpId: "exp_1" as string | null,
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
    expect(screen.getByRole("button", { name: "Melhorar experiências com IA" })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "Melhorar experiências com IA" }));
    expect(p.onExperience).toHaveBeenCalledWith("exp_1");
  });

  it("com firstExpId null, o atalho de experiências fica desabilitado e explica", () => {
    hub({ firstExpId: null });
    expect((screen.getByRole("button", { name: "Melhorar experiências com IA" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Adicione uma experiência para usar o assistente nela.")).toBeTruthy();
  });
});
