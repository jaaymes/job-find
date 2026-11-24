import { afterEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "@/lib/client/ai/providers";
import { testConnection } from "@/lib/client/ai/test-connection";

afterEach(() => vi.unstubAllGlobals());

const reply = (status: number, body: unknown = {}) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

describe("testConnection", () => {
  it("OpenRouter: 402 em /key vira no_credit", async () => {
    reply(402);
    await expect(testConnection(PROVIDERS.openrouter, { apiKey: "k" })).rejects.toMatchObject({ code: "no_credit" });
  });

  it("OpenRouter: limit_remaining <= 0 vira budget", async () => {
    reply(200, { data: { limit_remaining: 0 } });
    await expect(testConnection(PROVIDERS.openrouter, { apiKey: "k" })).rejects.toMatchObject({ code: "budget" });
    reply(200, { data: { limit_remaining: -1.5 } });
    await expect(testConnection(PROVIDERS.openrouter, { apiKey: "k" })).rejects.toMatchObject({ code: "budget" });
  });

  it("OpenRouter: saldo positivo ou sem limite (null) conecta", async () => {
    reply(200, { data: { limit_remaining: 3.2 } });
    await expect(testConnection(PROVIDERS.openrouter, { apiKey: "k" })).resolves.toBeUndefined();
    reply(200, { data: { limit_remaining: null } });
    await expect(testConnection(PROVIDERS.openrouter, { apiKey: "k" })).resolves.toBeUndefined();
    reply(200, { data: { label: "ok" } });
    await expect(testConnection(PROVIDERS.openrouter, { apiKey: "k" })).resolves.toBeUndefined();
  });

  it("OpenRouter: 401 continua invalid_key", async () => {
    reply(401);
    await expect(testConnection(PROVIDERS.openrouter, { apiKey: "k" })).rejects.toMatchObject({ code: "invalid_key" });
  });

  it("demais provedores: 402 em /models vira no_credit", async () => {
    reply(402);
    await expect(testConnection(PROVIDERS.openai, { apiKey: "k" })).rejects.toMatchObject({ code: "no_credit" });
  });
});
