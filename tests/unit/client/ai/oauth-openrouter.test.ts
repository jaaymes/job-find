import { afterEach, describe, expect, it, vi } from "vitest";
import { AiError } from "@/lib/client/ai/errors";
import { openRouterFlow } from "@/lib/client/ai/oauth/openrouter";

const ORIGIN = "https://app.test";
const REDIRECT = "https://app.test/configuracoes/callback";

describe("adaptador OAuth do OpenRouter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("openRouterFlow.authorizeUrl: callback_url com ?state=, limit=5, expiration=1-year, S256", () => {
    const url = new URL(openRouterFlow.authorizeUrl({ redirectUri: REDIRECT, challenge: "ch", state: "st-1", origin: ORIGIN }));
    expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
    const cb = new URL(url.searchParams.get("callback_url")!);
    expect(cb.origin + cb.pathname).toBe(REDIRECT);
    expect(cb.searchParams.get("state")).toBe("st-1");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("expiration")).toBe("1-year");
  });

  it("exchange faz POST JSON em /api/v1/auth/keys e devolve { key }", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ key: "sk-or-x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await openRouterFlow.exchange({ code: "c", verifier: "v", redirectUri: REDIRECT, origin: ORIGIN })).toEqual({ key: "sk-or-x" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/auth/keys");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ code: "c", code_verifier: "v", code_challenge_method: "S256" });
  });

  it("401/403 vira invalid_key; 5xx é unavailable retryable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 401 })));
    await expect(openRouterFlow.exchange({ code: "c", verifier: "v", redirectUri: REDIRECT, origin: ORIGIN })).rejects.toMatchObject({
      code: "invalid_key",
      meta: { status: 401 },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 502 })));
    await expect(openRouterFlow.exchange({ code: "c", verifier: "v", redirectUri: REDIRECT, origin: ORIGIN })).rejects.toMatchObject({
      code: "unavailable",
      retryable: true,
    });
  });

  it("resposta 200 sem key vira AiError invalid_response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const err = await openRouterFlow.exchange({ code: "c", verifier: "v", redirectUri: REDIRECT, origin: ORIGIN }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).meta).toEqual({ reason: "invalid_response" });
  });
});
