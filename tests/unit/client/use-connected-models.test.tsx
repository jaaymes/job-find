import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { optionKey } from "@/components/settings/model-search";
import { useConnectedModels } from "@/components/settings/use-connected-models";
import { PROVIDERS } from "@/lib/client/ai/providers";
import { defaultAiSettings, type AiSettings } from "@/lib/client/ai/settings";

afterEach(() => vi.unstubAllGlobals());

function settingsWith(ids: ("openrouter" | "deepseek")[]): AiSettings {
  const s = defaultAiSettings();
  for (const id of ids)
    s.providers[id] = { key: "k", addedAt: "2026-01-01", source: "paste" };
  return s;
}

function stubFetch(openrouter: () => Response, deepseek: () => Response) {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://openrouter.ai/")) return openrouter();
    if (url.startsWith("https://api.deepseek.com/")) return deepseek();
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

const ok = (ids: string[]) => () =>
  new Response(JSON.stringify({ data: ids.map((id) => ({ id, name: id })) }), {
    status: 200,
  });

function wrap() {
  const client = new QueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("useConnectedModels", () => {
  it("mesmo id em dois provedores vira duas opções com chaves distintas", async () => {
    stubFetch(ok(["deepseek-chat"]), ok(["deepseek-chat"]));
    const { result } = renderHook(
      () => useConnectedModels(settingsWith(["openrouter", "deepseek"]), true),
      {
        wrapper: wrap(),
      },
    );
    await waitFor(() =>
      expect(result.current.states.every((s) => s.status === "success")).toBe(
        true,
      ),
    );
    const keys = result.current.options
      .filter((o) => o.id === "deepseek-chat")
      .map(optionKey);
    expect(keys).toEqual([
      "openrouter:deepseek-chat",
      "deepseek:deepseek-chat",
    ]);
  });

  it("um provedor com erro não derruba o outro", async () => {
    stubFetch(
      () => new Response("x", { status: 500 }),
      ok(["deepseek-reasoner"]),
    );
    const { result } = renderHook(
      () => useConnectedModels(settingsWith(["openrouter", "deepseek"]), true),
      {
        wrapper: wrap(),
      },
    );
    await waitFor(() =>
      expect(result.current.states.every((s) => s.status !== "pending")).toBe(
        true,
      ),
    );
    expect(result.current.states.map((s) => [s.provider, s.status])).toEqual([
      ["openrouter", "error"],
      ["deepseek", "success"],
    ]);
    expect(
      result.current.options.some(
        (o) => o.provider === "deepseek" && o.id === "deepseek-reasoner",
      ),
    ).toBe(true);
  });

  it("injeta o modelo salvo na tarefa que a API não devolveu", async () => {
    stubFetch(ok(["a/b"]), ok(["deepseek-chat"]));
    const s = settingsWith(["openrouter"]);
    s.tasks.analyze = { provider: "openrouter", model: "x/sumiu" };
    const { result } = renderHook(() => useConnectedModels(s, true), {
      wrapper: wrap(),
    });
    await waitFor(() =>
      expect(result.current.states[0].status).toBe("success"),
    );
    expect(result.current.options).toContainEqual({
      id: "x/sumiu",
      label: "x/sumiu",
      provider: "openrouter",
    });
  });

  it("não injeta escolha de provedor desconectado", async () => {
    stubFetch(ok(["a/b"]), ok(["deepseek-chat"]));
    const s = settingsWith(["openrouter"]);
    s.tasks.analyze = { provider: "deepseek", model: "x/sumiu" };
    const { result } = renderHook(() => useConnectedModels(s, true), {
      wrapper: wrap(),
    });
    await waitFor(() =>
      expect(result.current.states[0].status).toBe("success"),
    );
    expect(result.current.options.some((o) => o.id === "x/sumiu")).toBe(false);
  });

  it("enabled false não faz fetch", async () => {
    const fn = stubFetch(ok([]), ok([]));
    const { result } = renderHook(
      () => useConnectedModels(settingsWith(["openrouter", "deepseek"]), false),
      { wrapper: wrap() },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(fn).not.toHaveBeenCalled();
    expect(result.current.states.map((s) => s.status)).toEqual([
      "pending",
      "pending",
    ]);
  });

  it("injeta os defaultModels que a API não devolveu", async () => {
    stubFetch(ok(["a/b"]), ok(["deepseek-chat"]));
    const { result } = renderHook(
      () => useConnectedModels(settingsWith(["openrouter"]), true),
      { wrapper: wrap() },
    );
    await waitFor(() =>
      expect(result.current.states[0].status).toBe("success"),
    );
    for (const id of Object.values(PROVIDERS.openrouter.defaultModels)) {
      expect(result.current.options).toContainEqual({
        id,
        label: id,
        provider: "openrouter",
      });
    }
  });

  it("não duplica o id que a API já devolveu para o provedor", async () => {
    const def = PROVIDERS.openrouter.defaultModels.analyze;
    stubFetch(ok([def]), ok([]));
    const s = settingsWith(["openrouter"]);
    s.tasks.analyze = { provider: "openrouter", model: def };
    const { result } = renderHook(() => useConnectedModels(s, true), {
      wrapper: wrap(),
    });
    await waitFor(() =>
      expect(result.current.states[0].status).toBe("success"),
    );
    expect(result.current.options.filter((o) => o.id === def)).toHaveLength(1);
  });

  it("rerender com settings iguais mantém a identidade de options e states", async () => {
    stubFetch(ok(["a/b"]), ok(["deepseek-chat"]));
    const { result, rerender } = renderHook(
      () => useConnectedModels(settingsWith(["openrouter", "deepseek"]), true),
      { wrapper: wrap() },
    );
    await waitFor(() =>
      expect(result.current.states.every((s) => s.status === "success")).toBe(
        true,
      ),
    );
    const { options, states } = result.current;
    rerender();
    expect(result.current.options).toBe(options);
    expect(result.current.states).toBe(states);
  });
});
