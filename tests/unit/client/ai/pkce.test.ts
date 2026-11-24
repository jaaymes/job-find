import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "@/lib/client/ai/errors";
import { completeOpenRouterAuth, startOpenRouterAuth, takeFreeConsentIntent } from "@/lib/client/ai/pkce";

const KEY = "jobfind:pkce";

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("PKCE do OpenRouter", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("startOpenRouterAuth monta a URL com challenge S256 e guarda o verifier", async () => {
    const url = new URL(await startOpenRouterAuth("https://app/configuracoes/callback"));
    expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
    expect(url.searchParams.get("callback_url")).toBe("https://app/configuracoes/callback");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(url.searchParams.get("expiration")).toBe("1-year");
    const verifier = sessionStorage.getItem(KEY);
    expect(verifier).toBeTruthy();
    expect(verifier!.length).toBeGreaterThanOrEqual(43);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier!)));
    expect(url.searchParams.get("code_challenge")).toBe(b64url(digest));
    expect(url.toString()).not.toContain(verifier!);
  });

  it("completeOpenRouterAuth troca o code pela chave e apaga o verifier", async () => {
    await startOpenRouterAuth("https://app/cb");
    const verifier = sessionStorage.getItem(KEY);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ key: "sk-or-x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await completeOpenRouterAuth("c")).toBe("sk-or-x");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/auth/keys");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      code: "c",
      code_verifier: verifier,
      code_challenge_method: "S256",
    });
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("o aceite dos gratuitos atravessa o redirect e é lido uma vez só", async () => {
    await startOpenRouterAuth("https://app/cb", { freeConsent: true });
    expect(takeFreeConsentIntent()).toBe(true);
    expect(takeFreeConsentIntent()).toBe(false);
    await startOpenRouterAuth("https://app/cb");
    expect(takeFreeConsentIntent()).toBe(false);
  });

  it("sem verifier lança AiError sem chamar a rede", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(completeOpenRouterAuth("c")).rejects.toMatchObject({ code: "unavailable", meta: { reason: "missing_verifier" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resposta não-2xx vira AiError e apaga o verifier, sem vazar segredos", async () => {
    await startOpenRouterAuth("https://app/cb");
    const verifier = sessionStorage.getItem(KEY)!;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 403 })));
    const err = await completeOpenRouterAuth("codigo-secreto").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("invalid_key");
    expect(JSON.stringify(err) + String((err as AiError).message)).not.toContain(verifier);
    expect(String((err as AiError).message)).not.toContain("codigo-secreto");
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("falha de rede vira AiError e apaga o verifier", async () => {
    await startOpenRouterAuth("https://app/cb");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(completeOpenRouterAuth("c")).rejects.toBeInstanceOf(AiError);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("resposta 200 sem key vira AiError", async () => {
    await startOpenRouterAuth("https://app/cb");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await expect(completeOpenRouterAuth("c")).rejects.toBeInstanceOf(AiError);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
