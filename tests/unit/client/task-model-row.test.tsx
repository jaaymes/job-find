import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskModelRow } from "@/components/settings/TaskModelRow";
import type { ModelInfo } from "@/lib/client/ai/providers";
import { defaultAiSettings, type AiSettings } from "@/lib/client/ai/settings";

afterEach(cleanup);

function setup(settings = defaultAiSettings()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskModelRow task="analyze" settings={settings} onChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe("TaskModelRow", () => {
  it("provedor salvo que não está mais conectado mostra o aviso, não 'Automático' em silêncio", () => {
    setup({
      ...defaultAiSettings(),
      tasks: { extract: null, analyze: { provider: "anthropic", model: "m" }, cv: null },
    });
    expect(screen.getByText(/Provedor escolhido não está conectado/)).toBeTruthy();
    expect((screen.getByLabelText("Provedor") as HTMLSelectElement).selectedOptions[0].textContent).toBe(
      "Anthropic (Claude) (não conectado)",
    );
  });

  it("sem escolha salva, não mostra o aviso", () => {
    setup();
    expect(screen.queryByText(/Provedor escolhido não está conectado/)).toBeNull();
  });
});

const ADDED_AT = "2026-11-24T00:00:00.000Z";

const MODELS: ModelInfo[] = [
  { id: "anthropic/claude-haiku", label: "Claude Haiku", priceIn: 1, priceOut: 5 },
  { id: "x/sem-preco", label: "Outro Modelo" },
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek Flash", priceIn: 0.2, priceOut: 0.8 },
  { id: "acme/livre:free", label: "Livre", priceIn: 0, priceOut: 0 },
  { id: "openrouter/free", label: "Free Models Router", priceIn: 0, priceOut: 0 },
  { id: "google/gemini-flash", label: "Gêmini Flash", priceIn: 0.1, priceOut: 0.4 },
];

function openRouterSettings(model = "deepseek/deepseek-v4.1-flash"): AiSettings {
  return {
    ...defaultAiSettings(),
    providers: { openrouter: { key: "sk-or-test", addedAt: ADDED_AT, source: "paste" } },
    tasks: { extract: { provider: "openrouter", model }, analyze: null, cv: null },
  };
}

function setupModel(settings = openRouterSettings(), onChange = vi.fn()) {
  const client = new QueryClient();
  client.setQueryData(["ai-models", "openrouter", ADDED_AT], MODELS);
  const ui = (s: AiSettings) => (
    <QueryClientProvider client={client}>
      <TaskModelRow task="extract" settings={s} onChange={onChange} />
    </QueryClientProvider>
  );
  const { rerender } = render(ui(settings));
  return {
    onChange,
    input: screen.getByRole("combobox", { name: "Modelo" }) as HTMLInputElement,
    rerender: (s: AiSettings) => rerender(ui(s)),
  };
}

/** Digitação real: o Base UI só abre o popup quando o evento traz `inputType` (autofill não abre). */
function type(input: HTMLInputElement, text: string) {
  fireEvent.focus(input);
  fireEvent.input(input, { target: { value: text }, inputType: "insertText" });
}

/** Opções do popup (em portal); o `<select>` do Provedor também tem options, por isso a busca fica no listbox. */
async function modelOptions() {
  return within(await screen.findByRole("listbox")).queryAllByRole("option");
}

async function openList() {
  fireEvent.click(screen.getByRole("button", { name: "Abrir lista de modelos" }));
  return modelOptions();
}

describe("TaskModelRow: campo Modelo pesquisável", () => {
  it("o campo Modelo é um combobox com o rótulo 'Modelo'", () => {
    setupModel();
    expect(screen.getByRole("combobox", { name: "Modelo" })).toBeTruthy();
  });

  it("lista do mais barato ao mais caro, com o preço em cada item", async () => {
    setupModel();
    const options = (await openList()).map((o) => o.textContent ?? "");
    expect(options).toHaveLength(6);
    expect(options[0]).toContain("Free Models Router (recomendado)");
    expect(options[0]).toContain("grátis");
    expect(options[1]).toContain("Livre");
    expect(options[1]).toContain("grátis");
    expect(options[2]).toContain("Gêmini Flash");
    expect(options[2]).toMatch(/≈ US\$ 0,\d+ por currículo/);
    expect(options[3]).toContain("DeepSeek Flash");
    expect(options[3]).toMatch(/≈ US\$ 0,\d+ por currículo/);
    expect(options[4]).toContain("Claude Haiku");
    expect(options[4]).toMatch(/≈ US\$ 0,\d+ por currículo/);
    expect(options[5]).toContain("Outro Modelo");
    expect(options[5]).toContain("sem preço");
  });

  it("filtra ignorando caixa e acento", async () => {
    const { input } = setupModel();
    type(input, "gemini");
    let options = await modelOptions();
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining("Gêmini Flash")]);
    type(input, "CLAUDE");
    options = await modelOptions();
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining("Claude Haiku")]);
    type(input, "deepseek/");
    options = await modelOptions();
    expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining("DeepSeek Flash")]);
  });

  it("sem resultado mostra 'Nenhum modelo encontrado'", async () => {
    const { input } = setupModel();
    type(input, "zzz-inexistente");
    expect(await screen.findByText("Nenhum modelo encontrado")).toBeTruthy();
    expect(screen.queryByRole("listbox") ? await modelOptions() : []).toHaveLength(0);
  });

  it("modelo salvo fora da lista do provedor continua visível e selecionado", async () => {
    const { input } = setupModel(openRouterSettings("meu/modelo-antigo"));
    expect(input.value).toBe("meu/modelo-antigo");
    const options = await openList();
    const saved = options.find((o) => o.textContent?.includes("meu/modelo-antigo"));
    expect(saved).toBeTruthy();
    expect(saved?.getAttribute("aria-selected")).toBe("true");
  });

  it("re-render com as mesmas props não apaga o que o usuário digitou (modelo salvo fora da lista)", async () => {
    const { input, rerender } = setupModel(openRouterSettings("meu/modelo-antigo"));
    type(input, "gemini");
    await modelOptions();
    expect(input.value).toBe("gemini");
    rerender(openRouterSettings("meu/modelo-antigo"));
    expect(input.value).toBe("gemini");
  });

  it("escolher um item chama onChange com provider e model", async () => {
    const { input, onChange } = setupModel();
    expect(input.value).toBe("DeepSeek Flash");
    const options = await openList();
    fireEvent.click(options.find((o) => o.textContent?.includes("Claude Haiku"))!);
    expect(onChange).toHaveBeenCalledWith({ provider: "openrouter", model: "anthropic/claude-haiku" });
  });

  it("sem provedor ativo, o campo fica desabilitado com o texto 'Modelo padrão do provedor'", () => {
    setup();
    const input = screen.getByRole("combobox", { name: "Modelo" }) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.placeholder).toBe("Modelo padrão do provedor");
  });
});
