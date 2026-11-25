import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskModelRow } from "@/components/settings/TaskModelRow";
import type { AiTask } from "@/lib/client/ai/providers";
import { defaultAiSettings, type AiSettings } from "@/lib/client/ai/settings";
import { ADDED_AT, MODELS, openRouterSettings } from "./model-fixtures";

afterEach(cleanup);

function setup(settings: AiSettings = defaultAiSettings(), task: AiTask = "extract", onChange = vi.fn()) {
  const client = new QueryClient();
  client.setQueryData(["ai-models", "openrouter", ADDED_AT], MODELS);
  render(
    <QueryClientProvider client={client}>
      <TaskModelRow task={task} settings={settings} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { onChange };
}

describe("TaskModelRow: resumo da tarefa", () => {
  it("provedor salvo que não está mais conectado mostra o aviso, não 'Automático' em silêncio", () => {
    setup(
      { ...defaultAiSettings(), tasks: { extract: null, analyze: { provider: "anthropic", model: "m" }, cv: null } },
      "analyze",
    );
    expect(screen.getByRole("alert").textContent).toMatch(/Provedor escolhido não está conectado/);
  });

  it("sem escolha salva, não mostra o aviso", () => {
    setup();
    expect(screen.queryByText(/Provedor escolhido não está conectado/)).toBeNull();
  });

  it("sem provedor conectado, o botão 'Trocar modelo' fica desabilitado", () => {
    setup();
    expect((screen.getByRole("button", { name: "Trocar modelo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("sem escolha salva mostra 'Automático'", () => {
    setup(openRouterSettings(null));
    expect(screen.getByText("Automático")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Trocar modelo" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("escolha salva mostra modelo · provedor e o custo", () => {
    setup(openRouterSettings("anthropic/claude-haiku"));
    expect(screen.getByText("Claude Haiku · OpenRouter")).toBeTruthy();
    expect(screen.getByText(/≈ US\$ 0,\d+ por currículo/)).toBeTruthy();
  });

  it("modelo sem preço não mostra custo", () => {
    setup(openRouterSettings("x/sem-preco"));
    expect(screen.getByText("Outro Modelo · OpenRouter")).toBeTruthy();
    expect(screen.queryByText(/US\$/)).toBeNull();
    expect(screen.queryByText(/grátis por/)).toBeNull();
    expect(screen.queryByText(/sem preço|não informado/)).toBeNull();
  });

  it("modelo ':free' mostra o aviso de modelos gratuitos", () => {
    setup(openRouterSettings("acme/livre:free"));
    expect(screen.getByRole("note").textContent).toMatch(/Modelos gratuitos têm limite de uso por dia/);
  });

  it("modelo pago não mostra o aviso de gratuitos", () => {
    setup(openRouterSettings("anthropic/claude-haiku"));
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("'Trocar modelo' abre o modal; escolher um modelo chama onChange e fecha", async () => {
    const { onChange } = setup(openRouterSettings("anthropic/claude-haiku"));
    fireEvent.click(screen.getByRole("button", { name: "Trocar modelo" }));
    const dialog = await screen.findByRole("dialog", { name: "Modelo para Ler currículo" });
    const row = within(dialog)
      .getAllByRole("option")
      .find((o) => o.textContent?.includes("Gêmini Flash"))!;
    fireEvent.click(row);
    expect(onChange).toHaveBeenCalledWith({ provider: "openrouter", model: "google/gemini-flash" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("TaskModelRow: voltar ao automático", () => {
  const STALE: AiSettings = {
    ...defaultAiSettings(),
    tasks: { extract: { provider: "anthropic", model: "m" }, analyze: null, cv: null },
  };

  it("escolha com provedor desconectado mostra 'Usar automático', que grava null", () => {
    const { onChange } = setup(STALE);
    fireEvent.click(screen.getByRole("button", { name: "Usar automático" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("sem escolha desconectada, não mostra 'Usar automático'", () => {
    setup(openRouterSettings("anthropic/claude-haiku"));
    expect(screen.queryByRole("button", { name: "Usar automático" })).toBeNull();
    cleanup();
    setup();
    expect(screen.queryByRole("button", { name: "Usar automático" })).toBeNull();
  });
});

