import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderCard } from "@/components/settings/ProviderCard";
import { PROVIDERS } from "@/lib/client/ai/providers";
import type { AiSettings } from "@/lib/client/ai/settings";

afterEach(cleanup);

type Entry = AiSettings["providers"]["openrouter"];

type Extra = { oauthError?: string | null; variant?: "card" | "compact" };

function setup(id: "openrouter" | "openai" | "local", entry?: Entry, extra: Extra = {}) {
  const handlers = { onAdd: vi.fn(), onConnectOAuth: vi.fn(), onRemove: vi.fn(), onReviewPrivacy: vi.fn() };
  render(<ProviderCard def={PROVIDERS[id]} entry={entry} connected={entry !== undefined} {...handlers} {...extra} />);
  return handlers;
}

describe("ProviderCard", () => {
  it("oauth mostra 'Conectar com OpenRouter' e chama onConnectOAuth", () => {
    const h = setup("openrouter");
    fireEvent.click(screen.getByRole("button", { name: "Conectar com OpenRouter" }));
    expect(h.onConnectOAuth).toHaveBeenCalledOnce();
    expect(h.onAdd).not.toHaveBeenCalled();
  });

  it("só o OpenRouter mostra o selo 'Recomendado'", () => {
    setup("openrouter");
    expect(screen.getByText("Recomendado")).toBeTruthy();
    cleanup();
    setup("openai");
    expect(screen.queryByText("Recomendado")).toBeNull();
  });

  it("paste mostra 'Adicionar chave' e chama onAdd", () => {
    const h = setup("openai");
    fireEvent.click(screen.getByRole("button", { name: "Adicionar chave" }));
    expect(h.onAdd).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /Conectar com/ })).toBeNull();
  });

  it("conectado por oauth mostra 'Conectado pelo login do OpenRouter em' e os 4 últimos caracteres", () => {
    setup("openrouter", { key: "sk-or-abcd9876", addedAt: "2026-11-20T12:00:00.000Z", source: "oauth", freeConsent: true });
    expect(screen.getByText(/Conectado pelo login do OpenRouter em .+\. Chave terminada em 9876\./)).toBeTruthy();
  });

  it("conectado por chave colada mostra 'Chave colada em'", () => {
    setup("openai", { key: "sk-abcd1234", addedAt: "2026-11-20T12:00:00.000Z", source: "paste" });
    expect(screen.getByText(/Chave colada em .+\. Chave terminada em 1234\./)).toBeTruthy();
  });

  it("auth 'none' (IA local) mostra 'Configurar' e chama onAdd", () => {
    const h = setup("local");
    fireEvent.click(screen.getByRole("button", { name: "Configurar" }));
    expect(h.onAdd).toHaveBeenCalledOnce();
  });

  it("oauthError aparece como alerta", () => {
    setup("openrouter", undefined, { oauthError: "Falhou" });
    expect(screen.getByRole("alert").textContent).toBe("Falhou");
  });
});

describe("ProviderCard compact", () => {
  const OAUTH: Entry = { key: "sk-or-abcd9876", addedAt: "2026-11-20T12:00:00.000Z", source: "oauth", freeConsent: true };
  const PASTE: Entry = { key: "sk-abcd1234", addedAt: "2026-11-20T12:00:00.000Z", source: "paste" };

  it("mostra Testar e Remover, sem a descrição longa", () => {
    const h = setup("openai", PASTE, { variant: "compact" });
    expect(screen.getByRole("button", { name: /Testar/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Remover/ }));
    expect(h.onRemove).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Modelos GPT com a sua chave/)).toBeNull();
    expect(screen.queryByText(/Chave colada em/)).toBeNull();
  });

  it("mostra a forma de conexão: 'Chave colada' ou 'Conectado com OAuth'", () => {
    setup("openai", PASTE, { variant: "compact" });
    expect(screen.getByText("Chave colada")).toBeTruthy();
    cleanup();
    setup("openrouter", OAUTH, { variant: "compact" });
    expect(screen.getByText("Conectado com OAuth")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Desconectar" })).toBeTruthy();
  });

  it("mostra 'revisar aviso' quando o aviso não foi aceito", () => {
    const h = setup("openrouter", { ...OAUTH, freeConsent: undefined }, { variant: "compact" });
    fireEvent.click(screen.getByRole("button", { name: "Revisar aviso dos modelos gratuitos" }));
    expect(h.onReviewPrivacy).toHaveBeenCalledOnce();
  });

  it("mostra o erro de OAuth", () => {
    setup("openrouter", OAUTH, { variant: "compact", oauthError: "Falhou" });
    expect(screen.getByRole("alert").textContent).toBe("Falhou");
  });
});
