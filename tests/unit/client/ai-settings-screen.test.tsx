import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiSettingsScreen } from "@/components/settings/AiSettingsScreen";
import { PROVIDER_IDS, PROVIDERS } from "@/lib/client/ai/providers";
import { aiSettingsStore, defaultAiSettings } from "@/lib/client/ai/settings";
import { BTN_PRIMARY } from "@/components/ui/styles";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
  it("sem provedor conectado, só 'Provedores' aparece (sem as tarefas) e o estado diz 'Nenhuma IA conectada'", () => {
    renderScreen();
    expect(sectionOrder()).toEqual(["Provedores"]);
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

    expect(screen.queryByRole("list", { name: "Provedor recomendado" })).toBeNull();
    const rows = screen.getByRole("list", { name: "Provedores para conectar" });
    expect(within(rows).queryByRole("button", { name: /OpenRouter/ })).toBeNull();
    expect(within(rows).getByRole("button", { name: /OpenAI/ })).toBeTruthy();
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

  it("a linha de estado do cabeçalho é um role='status'", () => {
    renderScreen();
    expect(screen.getByRole("status").textContent).toBe("Nenhuma IA conectada");
  });

  it("as listas de provedores têm role='list' explícito (o list-style: none tira a semântica no Safari)", () => {
    aiSettingsStore.set({
      ...defaultAiSettings(),
      providers: { openrouter: { key: "sk-or-abcd9876", addedAt: "2026-11-24T00:00:00.000Z", source: "oauth" } },
    });
    renderScreen();
    for (const name of ["Provedores conectados", "Provedores para conectar", "Mais provedores para conectar"]) {
      expect(screen.getByRole("list", { name, hidden: true }).getAttribute("role")).toBe("list");
    }
  });

  it("'Mais provedores' lista só os provedores 'should' não conectados", () => {
    aiSettingsStore.set({
      ...defaultAiSettings(),
      providers: { groq: { key: "gsk-abcd1111", addedAt: "2026-11-24T00:00:00.000Z", source: "paste" } },
    });
    renderScreen();
    const should = PROVIDER_IDS.filter((id) => PROVIDERS[id].tier === "should");
    const expected = should.filter((id) => id !== "groq").map((id) => PROVIDERS[id].label);
    expect(screen.getByText(`Mais provedores (${expected.length})`)).toBeTruthy();
    const more = screen.getByRole("list", { name: "Mais provedores para conectar", hidden: true });
    const names = within(more)
      .getAllByRole("button", { hidden: true })
      .map((b) => b.querySelector("span span")?.textContent);
    expect(names).toEqual(expected);
    const connected = screen.getByRole("list", { name: "Provedores conectados" });
    expect(within(connected).getByRole("heading", { name: "Groq" })).toBeTruthy();
  });
});

describe("AiSettingsScreen: foco após reordenar", () => {
  it("ao remover o único provedor, o foco vai para o título 'Provedores'", async () => {
    aiSettingsStore.set({
      ...defaultAiSettings(),
      providers: { openai: { key: "sk-abcd1234", addedAt: "2026-11-24T00:00:00.000Z", source: "paste" } },
    });
    renderScreen();
    const removeBtn = screen.getByRole("button", { name: "Remover chave" });
    removeBtn.focus();
    fireEvent.click(removeBtn);
    const heading = screen.getByRole("heading", { level: 2, name: "Provedores" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(heading.getAttribute("tabindex")).toBe("-1");
    expect(screen.queryByRole("list", { name: "Provedores conectados" })).toBeNull();
  });

  it("ao salvar uma chave colada, o card some da grade e o foco vai para o título 'Provedores'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "gpt-5-mini" }] }), { status: 200 })),
    );
    renderScreen();
    const grid = screen.getByRole("list", { name: "Provedores para conectar" });
    fireEvent.click(within(grid).getByRole("button", { name: /OpenAI/ }));
    const sheet = await screen.findByRole("dialog", { name: "OpenAI" });
    const add = within(sheet).getByRole("button", { name: "Adicionar chave" });
    add.focus();
    fireEvent.click(add);
    const dialog = await screen.findByRole("dialog", { name: /Adicionar chave/ });
    fireEvent.change(within(dialog).getByLabelText("Chave de API"), { target: { value: "sk-test-abcd1234" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Testar e salvar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(screen.getByRole("list", { name: "Provedores conectados" })).getByRole("heading", { name: "OpenAI" })).toBeTruthy();
    const heading = screen.getByRole("heading", { level: 2, name: "Provedores" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("ao aceitar o aviso pelo 'Revisar aviso', o botão some e o foco vai para o título 'Provedores'", async () => {
    aiSettingsStore.set({
      ...defaultAiSettings(),
      providers: { openrouter: { key: "sk-or-abcd9876", addedAt: "2026-11-24T00:00:00.000Z", source: "oauth" } },
    });
    renderScreen();
    const review = screen.getByRole("button", { name: "Revisar aviso dos modelos gratuitos" });
    review.focus();
    fireEvent.click(review);
    const dialog = await screen.findByRole("dialog", { name: /Aviso dos modelos gratuitos/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Entendi e aceito" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("button", { name: "Revisar aviso dos modelos gratuitos" })).toBeNull();
    const heading = screen.getByRole("heading", { level: 2, name: "Provedores" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("cancelar o aviso devolve o foco ao botão que o abriu", async () => {
    aiSettingsStore.set({
      ...defaultAiSettings(),
      providers: { openrouter: { key: "sk-or-abcd9876", addedAt: "2026-11-24T00:00:00.000Z", source: "oauth" } },
    });
    renderScreen();
    const review = screen.getByRole("button", { name: "Revisar aviso dos modelos gratuitos" });
    review.focus();
    fireEvent.click(review);
    const dialog = await screen.findByRole("dialog", { name: /Aviso dos modelos gratuitos/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(review));
  });
});

describe("AiSettingsScreen: hierarquia (D-10)", () => {
  it("só o OpenRouter tem botão primário entre os provedores", () => {
    renderScreen();
    const primary = BTN_PRIMARY.split(" ").filter((c) => c.startsWith("bg-jf-brand") && !c.includes(":"));
    const buttons = screen.getAllByRole("button", { hidden: true }).filter((b) => primary.every((c) => b.classList.contains(c)));
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe("Conectar com OpenRouter");
  });

  it("os outros provedores são linhas que abrem um diálogo com a ação", () => {
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: /OpenAI/ }));
    const dialog = screen.getByRole("dialog", { name: "OpenAI" });
    expect(within(dialog).getByRole("button", { name: "Adicionar chave" })).toBeTruthy();
  });

  it("Modelo por tarefa fica oculto sem provedor conectado", () => {
    renderScreen();
    expect(screen.queryByRole("heading", { name: "Modelo para cada tarefa" })).toBeNull();
  });

  it("título da página é Configurações e há a seção Dados e backup", () => {
    renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Configurações" })).toBeTruthy();
    const section = screen.getByRole("heading", { level: 2, name: "Dados e backup" }).closest("section");
    expect(section?.id).toBe("dados-e-backup");
  });
});
