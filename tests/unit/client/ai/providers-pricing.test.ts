import { afterEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "@/lib/client/ai/providers";

function stubFetch(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("preço dos modelos (Together, Gateway, local)", () => {
  it("Together: pricing.input/output já em USD por 1M", async () => {
    stubFetch([{ id: "meta-llama/x", display_name: "Llama X", pricing: { input: 0.88, output: 0.88 } }]);
    expect(await PROVIDERS.together.listModels({ apiKey: "k" })).toEqual([
      { id: "meta-llama/x", label: "Llama X", priceIn: 0.88, priceOut: 0.88 },
    ]);
  });

  it("Together: aceita { data: [...] } e preço em texto", async () => {
    stubFetch({ data: [{ id: "a/b", pricing: { input: "0.5", output: "1.5" } }] });
    expect(await PROVIDERS.together.listModels({ apiKey: "k" })).toEqual([
      { id: "a/b", label: "a/b", priceIn: 0.5, priceOut: 1.5 },
    ]);
  });

  it("Vercel AI Gateway: pricing em USD por token vira USD por 1M", async () => {
    stubFetch({
      data: [{ id: "openai/gpt-5-mini", name: "GPT-5 mini", pricing: { input: "0.00000025", output: "0.000002" } }],
    });
    const r = await PROVIDERS["vercel-gateway"].listModels({ apiKey: "k" });
    expect(r[0]).toMatchObject({ id: "openai/gpt-5-mini", label: "GPT-5 mini", priceIn: 0.25, priceOut: 2 });
  });

  it("pricing ausente ou inválido vira sem preço, sem quebrar a lista", async () => {
    stubFetch([
      { id: "a", pricing: { input: "abc", output: -1 } },
      { id: "b" },
      { id: "c", pricing: null },
      { nope: true },
    ]);
    const t = await PROVIDERS.together.listModels({ apiKey: "k" });
    expect(t.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(t.every((m) => m.priceIn === undefined && m.priceOut === undefined)).toBe(true);

    stubFetch({ data: [{ id: "x", name: "X", pricing: { input: "zz" } }, { id: "y" }] });
    const g = await PROVIDERS["vercel-gateway"].listModels({ apiKey: "k" });
    expect(g).toHaveLength(2);
    expect(g[0].priceIn).toBeUndefined();
    expect(g[1].priceOut).toBeUndefined();
  });

  it("IA local é grátis", async () => {
    stubFetch({ data: [{ id: "llama3.2" }] });
    const r = await PROVIDERS.local.listModels({});
    expect(r[0]).toMatchObject({ id: "llama3.2", priceIn: 0, priceOut: 0 });
  });
});
