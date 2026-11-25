import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiSettingsScreen } from "@/components/settings/AiSettingsScreen";
import { aiSettingsStore, defaultAiSettings } from "@/lib/client/ai/settings";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function renderScreen() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AiSettingsScreen />
    </QueryClientProvider>,
  );
}

function sectionOrder(): string[] {
  return screen
    .getAllByRole("heading", { level: 2 })
    .map((h) => h.textContent ?? "")
    .filter((t) => t === "Provedores" || t === "Modelo para cada tarefa");
}

describe("AiSettingsScreen: estrutura", () => {
  it("sem provedor conectado, 'Provedores' vem antes das tarefas e o estado diz 'Nenhuma IA conectada'", () => {
    renderScreen();
    expect(sectionOrder()).toEqual(["Provedores", "Modelo para cada tarefa"]);
    expect(screen.getByText("Nenhuma IA conectada")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Provedores conectados" })).toBeNull();
  });

  it("com o OpenRouter conectado, as tarefas vêm primeiro e ele aparece só na lista compacta", () => {
    aiSettingsStore.set({
      ...defaultAiSettings(),
      providers: { openrouter: { key: "sk-or-abcd9876", addedAt: "2026-11-24T00:00:00.000Z", source: "oauth" } },
    });
    renderScreen();
    expect(sectionOrder()).toEqual(["Modelo para cada tarefa", "Provedores"]);
    expect(screen.getByText("1 provedor conectado")).toBeTruthy();

    const connected = screen.getByRole("list", { name: "Provedores conectados" });
    expect(within(connected).getByRole("heading", { name: "OpenRouter" })).toBeTruthy();
    expect(within(connected).getByText("Conectado com OAuth")).toBeTruthy();

    const grid = screen.getByRole("list", { name: "Provedores para conectar" });
    expect(within(grid).queryByRole("heading", { name: "OpenRouter" })).toBeNull();
    expect(within(grid).getByRole("heading", { name: "OpenAI" })).toBeTruthy();
  });

  it("com dois provedores conectados, o estado usa o plural", () => {
    aiSettingsStore.set({
      ...defaultAiSettings(),
      providers: {
        openrouter: { key: "sk-or-abcd9876", addedAt: "2026-11-24T00:00:00.000Z", source: "oauth" },
        openai: { key: "sk-abcd1234", addedAt: "2026-11-24T00:00:00.000Z", source: "paste" },
      },
    });
    renderScreen();
    expect(screen.getByText("2 provedores conectados")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Provedores conectados" })).getAllByRole("listitem")).toHaveLength(2);
  });
});
