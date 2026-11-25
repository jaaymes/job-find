import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelPickerDialog } from "@/components/settings/ModelPickerDialog";
import type { ModelInfo } from "@/lib/client/ai/providers";
import type { AiSettings } from "@/lib/client/ai/settings";
import { ADDED_AT, MODELS, openRouterSettings } from "./model-fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const DEEPSEEK_MODELS: ModelInfo[] = [
  { id: "deepseek-chat", label: "DeepSeek Chat", priceIn: 0.27, priceOut: 1.1 },
  { id: "deepseek/deepseek-v4.1-flash", label: "DeepSeek Flash", priceIn: 0.3, priceOut: 1 },
];

function bothSettings(model: string | null = "deepseek/deepseek-v4.1-flash"): AiSettings {
  const s = openRouterSettings(model);
  return { ...s, providers: { ...s.providers, deepseek: { key: "sk-ds", addedAt: ADDED_AT, source: "paste" } } };
}

function setup(settings: AiSettings = openRouterSettings(), { cache = true } = {}) {
  const client = new QueryClient();
  if (cache) {
    client.setQueryData(["ai-models", "openrouter", ADDED_AT], MODELS);
    client.setQueryData(["ai-models", "deepseek", ADDED_AT], DEEPSEEK_MODELS);
  }
  const onSelect = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ModelPickerDialog task="extract" settings={settings} open onOpenChange={onOpenChange} onSelect={onSelect} />
    </QueryClientProvider>,
  );
  return { onSelect, onOpenChange, input: screen.getByLabelText("Buscar modelo") as HTMLInputElement };
}

function options() {
  return within(screen.getByRole("listbox")).queryAllByRole("option");
}

/** Linhas de modelo (sem a opção fixa "Automático"). */
function modelRows() {
  return options().filter((o) => !o.textContent?.includes("Automático"));
}

function search(input: HTMLInputElement, text: string) {
  fireEvent.change(input, { target: { value: text } });
}

describe("ModelPickerDialog", () => {
  it("tem título e descrição da tarefa", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Modelo para Ler currículo" })).toBeTruthy();
    expect(screen.getByText("Transforma seu PDF em perfil estruturado.")).toBeTruthy();
  });

  it("abre com o foco no campo 'Buscar modelo'", async () => {
    const { input } = setup();
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("ordena grátis → mais barato → mais caro → sem preço, sem texto de preço no modelo sem preço", () => {
    setup();
    expect(options()[0].textContent).toContain("Automático (primeiro provedor conectado, modelo recomendado)");
    const rows = modelRows().map((o) => o.textContent ?? "");
    const order = ["Free Models Router", "Livre", "Gêmini Flash", "DeepSeek Flash", "Claude Haiku", "Outro Modelo"];
    expect(rows).toHaveLength(order.length);
    order.forEach((name, i) => expect(rows[i]).toContain(name));
    expect(rows[2]).toMatch(/≈ US\$ 0,\d+ por currículo/);
    expect(rows[5]).not.toContain("US$");
    expect(rows[5]).not.toContain("sem preço");
  });

  it("mostra os selos Atual, Recomendado e Grátis", () => {
    setup();
    const rows = modelRows();
    const router = rows.find((o) => o.textContent?.includes("Free Models Router"))!;
    expect(router.textContent).toContain("Recomendado");
    expect(router.textContent).toContain("Grátis");
    const flash = rows.find((o) => o.textContent?.includes("DeepSeek Flash"))!;
    expect(flash.textContent).toContain("Atual");
    expect(flash.textContent).not.toContain("Grátis");
  });

  it("busca filtra e, sem resultado, mostra 'Nenhum modelo encontrado' com 'Automático' visível", async () => {
    const { input } = setup();
    search(input, "gemini");
    await waitFor(() => expect(modelRows().map((o) => o.textContent)).toEqual([expect.stringContaining("Gêmini Flash")]));
    search(input, "zzz");
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Nenhum modelo encontrado"));
    expect(screen.getAllByText("Nenhum modelo encontrado")).toHaveLength(2);
    expect(modelRows()).toHaveLength(0);
    expect(options()[0].textContent).toContain("Automático");
  });

  it("chip do provedor mostra só os modelos dele", () => {
    setup(bothSettings());
    expect(screen.getByRole("button", { name: "OpenRouter (6)" })).toBeTruthy();
    const chip = screen.getByRole("button", { name: "DeepSeek (2)" });
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    const rows = modelRows();
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.textContent).not.toContain("OpenRouter");
    fireEvent.click(screen.getByRole("button", { name: "Todos" }));
    expect(modelRows()).toHaveLength(8);
  });

  it("chip 'Só gratuitos' mostra só os de custo 0", () => {
    setup();
    const chip = screen.getByRole("button", { name: "Só gratuitos" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(modelRows().map((o) => o.textContent)).toEqual([
      expect.stringContaining("Free Models Router"),
      expect.stringContaining("Livre"),
    ]);
  });

  it("'Só gratuitos' já vem ligado quando o modelo atual é grátis", () => {
    setup(openRouterSettings("acme/livre:free"));
    expect(screen.getByRole("button", { name: "Só gratuitos" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("'Só gratuitos' liga com o cache frio quando o modelo salvo é ':free'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );
    setup(openRouterSettings("acme/livre:free"), { cache: false });
    expect(screen.getByRole("button", { name: "Só gratuitos" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("'Só gratuitos' com o cache frio mantém o modelo salvo ':free' e o roteador grátis do OpenRouter", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
    );
    setup(openRouterSettings("acme/livre:free"), { cache: false });
    expect(screen.getByRole("button", { name: "Só gratuitos" }).getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(screen.queryByText(/Carregando modelos/)).toBeNull());
    const rows = modelRows().map((o) => o.textContent ?? "");
    expect(rows.some((t) => t.includes("acme/livre:free") && t.includes("Atual"))).toBe(true);
    expect(rows.some((t) => t.includes("openrouter/free"))).toBe(true);
    expect(rows.some((t) => t.includes("deepseek"))).toBe(false);
    expect(screen.queryByText("Nenhum modelo encontrado")).toBeNull();
  });

  it("modelo salvo que a API não devolve aparece com o selo 'Atual' e sem preço", () => {
    setup(openRouterSettings("meu/modelo-antigo"));
    const row = modelRows().find((o) => o.textContent?.includes("meu/modelo-antigo"));
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain("Atual");
    expect(row!.textContent).not.toContain("US$");
  });

  it("clicar num modelo chama onSelect com provider e model; 'Automático' chama onSelect(null)", () => {
    const { onSelect } = setup();
    fireEvent.click(modelRows().find((o) => o.textContent?.includes("DeepSeek Flash"))!);
    expect(onSelect).toHaveBeenCalledWith({ provider: "openrouter", model: "deepseek/deepseek-v4.1-flash" });
    fireEvent.click(options()[0]);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("mesmo id em dois provedores: a linha do DeepSeek grava provider 'deepseek'", () => {
    const { onSelect } = setup(bothSettings(null));
    const flashes = modelRows().filter((o) => o.textContent?.includes("DeepSeek Flash"));
    expect(flashes).toHaveLength(2);
    fireEvent.click(flashes.find((o) => !o.textContent?.includes("OpenRouter"))!);
    expect(onSelect).toHaveBeenCalledWith({ provider: "deepseek", model: "deepseek/deepseek-v4.1-flash" });
  });

  it("Enter escolhe o item destacado pelas setas", () => {
    const { input, onSelect } = setup();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith({ provider: "openrouter", model: "openrouter/free" });
  });

  it("OpenRouter com erro mostra o aviso e os modelos do DeepSeek continuam", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("https://openrouter.ai/")) return new Response("x", { status: 500 });
        if (url.startsWith("https://api.deepseek.com/"))
          return new Response(JSON.stringify({ data: [{ id: "deepseek-reasoner" }] }), { status: 200 });
        return new Response("{}", { status: 404 });
      }),
    );
    setup(bothSettings(), { cache: false });
    const msg = await screen.findByText("Não foi possível carregar os modelos de OpenRouter.");
    const retry = screen.getByRole("button", { name: "Tentar de novo" });
    // A região viva só tem textos; o botão fica fora dela.
    const live = msg.closest("[aria-live]")!;
    expect(live).toBeTruthy();
    expect(live.contains(retry)).toBe(false);
    expect(live.querySelector("button")).toBeNull();
    // Chip do provedor com erro não mostra contagem.
    expect(screen.getByRole("button", { name: "OpenRouter" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /OpenRouter \(/ })).toBeNull();
    await waitFor(() => expect(modelRows().some((o) => o.textContent?.includes("deepseek-reasoner"))).toBe(true));
  });

  it("a região aria-live fica no DOM mesmo sem nada carregando ou com erro", () => {
    setup();
    const live = document.querySelector("[role=dialog] [aria-live=polite]");
    expect(live).toBeTruthy();
    expect(live!.textContent).toBe("");
    expect(live!.className).not.toContain("empty:hidden");
  });

  it("anuncia a quantidade de modelos num status visualmente oculto", async () => {
    const { input } = setup();
    const status = screen.getByRole("status");
    expect(status.className).toContain("sr-only");
    expect(status.textContent).toBe("6 modelos");
    search(input, "gemini");
    await waitFor(() => expect(status.textContent).toBe("1 modelo"));
    fireEvent.click(screen.getByRole("button", { name: "Só gratuitos" }));
    await waitFor(() => expect(status.textContent).toBe("Nenhum modelo encontrado"));
  });

  it("linha grátis mostra só o selo 'Grátis', sem repetir 'grátis' no preço", () => {
    setup();
    const router = modelRows().find((o) => o.textContent?.includes("Free Models Router"))!;
    expect(router.textContent!.match(/grátis/gi)).toHaveLength(1);
    expect(router.textContent).toContain("Grátis");
  });

  it("reabrir zera a busca e recalcula o 'Só gratuitos' com o modelo salvo de agora", async () => {
    const client = new QueryClient();
    client.setQueryData(["ai-models", "openrouter", ADDED_AT], MODELS);
    const view = (open: boolean, settings: AiSettings) => (
      <QueryClientProvider client={client}>
        <ModelPickerDialog task="extract" settings={settings} open={open} onOpenChange={vi.fn()} onSelect={vi.fn()} />
      </QueryClientProvider>
    );
    const { rerender } = render(view(true, openRouterSettings()));
    search(screen.getByLabelText("Buscar modelo") as HTMLInputElement, "gemini");
    expect(screen.getByRole("button", { name: "Só gratuitos" }).getAttribute("aria-pressed")).toBe("false");
    rerender(view(false, openRouterSettings("acme/livre:free")));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    rerender(view(true, openRouterSettings("acme/livre:free")));
    const input = (await screen.findByLabelText("Buscar modelo")) as HTMLInputElement;
    expect(input.value).toBe("");
    expect(screen.getByRole("button", { name: "Só gratuitos" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("Esc fecha sem chamar onSelect", async () => {
    const { input, onSelect, onOpenChange } = setup();
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(onOpenChange.mock.calls.at(-1)?.[0]).toBe(false));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("'Cancelar' fecha sem chamar onSelect", () => {
    const { onSelect, onOpenChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
