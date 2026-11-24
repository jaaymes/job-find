import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiError } from "@/lib/client/ai/errors";
import { callbackUrl, cancelOAuth, completeOAuth, parseCallbackParams, PENDING_KEY, readPending, startOAuth } from "@/lib/client/ai/oauth";
import { PROVIDERS } from "@/lib/client/ai/providers";

const ORIGIN = "https://app.test";

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Pending = { provider: string; verifier: string; state: string; intent: { freeConsent?: boolean } };
const pending = (): Pending => JSON.parse(sessionStorage.getItem(PENDING_KEY)!) as Pending;

describe("OAuth genérico", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("callbackUrl aponta para /configuracoes/callback na origem", () => {
    expect(callbackUrl(ORIGIN)).toBe("https://app.test/configuracoes/callback");
  });

  it("startOAuth guarda pending com provider, verifier, state e intent; URL não contém o verifier", async () => {
    const url = await startOAuth("openrouter", ORIGIN, { freeConsent: true });
    expect(JSON.parse(sessionStorage.getItem(PENDING_KEY)!)).toMatchObject({ provider: "openrouter", intent: { freeConsent: true } });
    const p = pending();
    expect(p.verifier.length).toBeGreaterThanOrEqual(43);
    expect(p.state.length).toBeGreaterThanOrEqual(43);
    expect(url).not.toContain(p.verifier);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(p.verifier)));
    expect(new URL(url).searchParams.get("code_challenge")).toBe(b64url(digest));
  });

  it("startOAuth sem intent guarda intent vazio e cada início gera verifier e state novos", async () => {
    await startOAuth("openrouter", ORIGIN);
    const a = pending();
    expect(a.intent).toEqual({});
    await startOAuth("openrouter", ORIGIN);
    const b = pending();
    expect(b.verifier).not.toBe(a.verifier);
    expect(b.state).not.toBe(a.state);
  });

  it("startOAuth recusa provedor sem oauth", async () => {
    await expect(startOAuth("openai", ORIGIN)).rejects.toBeInstanceOf(AiError);
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("readPending devolve provider e intent sem consumir", async () => {
    expect(readPending()).toBeNull();
    await startOAuth("openrouter", ORIGIN, { freeConsent: true });
    expect(readPending()).toEqual({ provider: "openrouter", intent: { freeConsent: true } });
    expect(sessionStorage.getItem(PENDING_KEY)).not.toBeNull();
  });

  it("readPending ignora pending corrompido ou de provedor desconhecido", () => {
    sessionStorage.setItem(PENDING_KEY, "{nao-json");
    expect(readPending()).toBeNull();
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ provider: "nope", verifier: "v", state: "s", intent: {} }));
    expect(readPending()).toBeNull();
  });

  it("completeOAuth troca o code pela chave e apaga o pending", async () => {
    await startOAuth("openrouter", ORIGIN, { freeConsent: true });
    const { verifier, state } = pending();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ key: "sk-or-x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await completeOAuth({ code: "c", state, origin: ORIGIN });
    expect(res).toEqual({ provider: "openrouter", tokens: { key: "sk-or-x" }, intent: { freeConsent: true } });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ code: "c", code_verifier: verifier });
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("completeOAuth com state diferente lança state_mismatch, não chama fetch e limpa o pending", async () => {
    await startOAuth("openrouter", ORIGIN);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(completeOAuth({ code: "c", state: "errado", origin: ORIGIN })).rejects.toMatchObject({
      code: "unavailable",
      meta: { reason: "state_mismatch" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("completeOAuth sem state no retorno segue quando o flow declara stateOptional (OpenRouter)", async () => {
    expect(PROVIDERS.openrouter.auth.kind === "oauth" && PROVIDERS.openrouter.auth.flow.stateOptional).toBe(true);
    await startOAuth("openrouter", ORIGIN);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ key: "sk-or-x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(completeOAuth({ code: "c", state: null, origin: ORIGIN })).resolves.toMatchObject({ tokens: { key: "sk-or-x" } });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("completeOAuth com state vazio conta como ausente", async () => {
    await startOAuth("openrouter", ORIGIN);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ key: "sk-or-x" }), { status: 200 })));
    await expect(completeOAuth({ code: "c", state: "", origin: ORIGIN })).resolves.toMatchObject({ provider: "openrouter" });
  });

  it("completeOAuth sem state no retorno é state_mismatch quando o flow não declara stateOptional", async () => {
    const auth = PROVIDERS.openrouter.auth;
    if (auth.kind !== "oauth") throw new Error("OpenRouter deveria ser oauth");
    const original = auth.flow;
    const strict = { ...original, stateOptional: false };
    (auth as { flow: typeof original }).flow = strict;
    try {
      await startOAuth("openrouter", ORIGIN);
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(completeOAuth({ code: "c", state: null, origin: ORIGIN })).rejects.toMatchObject({
        meta: { reason: "state_mismatch" },
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    } finally {
      (auth as { flow: typeof original }).flow = original;
    }
  });

  it("cancelOAuth apaga o pending", async () => {
    await startOAuth("openrouter", ORIGIN);
    cancelOAuth();
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(readPending()).toBeNull();
  });

  it("completeOAuth sem pending lança missing_verifier", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(completeOAuth({ code: "c", state: "s", origin: ORIGIN })).rejects.toMatchObject({
      code: "unavailable",
      meta: { reason: "missing_verifier" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("erro de troca não carrega code, verifier nem chave em message/meta", async () => {
    await startOAuth("openrouter", ORIGIN);
    // Verifier conhecido para conferir que não vaza.
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending(), verifier: "verifier-secreto-0123456789" }));
    const { state } = pending();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ key: "sk-or-vazou" }), { status: 403 })));
    const err = (await completeOAuth({ code: "c0de-secreto", state, origin: ORIGIN }).catch((e: unknown) => e)) as AiError;
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe("invalid_key");
    expect(JSON.stringify({ m: err.message, meta: err.meta })).not.toMatch(/c0de|verif|sk-or/);
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("falha de rede vira AiError e apaga o pending", async () => {
    await startOAuth("openrouter", ORIGIN);
    const { state } = pending();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    await expect(completeOAuth({ code: "c", state, origin: ORIGIN })).rejects.toMatchObject({ meta: { reason: "network" } });
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });
});

describe("parseCallbackParams", () => {
  it("lê code, state e error do formato normal", () => {
    expect(parseCallbackParams(new URLSearchParams("?state=abc&code=x"))).toEqual({ code: "x", state: "abc", error: null });
    expect(parseCallbackParams(new URLSearchParams("?error=access_denied"))).toEqual({ code: null, state: null, error: "access_denied" });
  });

  it("tolera a concatenação ingênua '?state=abc?code=x'", () => {
    expect(parseCallbackParams(new URLSearchParams("?state=abc?code=x"))).toEqual({ code: "x", state: "abc", error: null });
    expect(parseCallbackParams(new URLSearchParams("?state=abc?code=x&foo=1"))).toMatchObject({ code: "x", state: "abc" });
  });

  it("state ou code vazios viram null", () => {
    expect(parseCallbackParams(new URLSearchParams("?code=&state="))).toEqual({ code: null, state: null, error: null });
  });
});
