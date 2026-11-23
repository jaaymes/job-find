import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageBanner } from "@/components/layout/StorageBanner";
import { act } from "react";
import { z } from "zod";
import {
  createStore,
  isStorageAvailable,
  resetStorageProbeForTests,
} from "@/lib/client/storage/store";

const UNAVAILABLE = "Não foi possível salvar neste navegador. A busca de vagas funciona normalmente.";
const NEAR_LIMIT = "Seus dados estão perto do limite. Exporte um backup e apague CVs antigos.";

describe("isStorageAvailable", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageProbeForTests();
  });
  afterEach(() => vi.restoreAllMocks());

  it("true quando o localStorage funciona e não deixa a chave de teste", () => {
    expect(isStorageAvailable()).toBe(true);
    expect(localStorage.length).toBe(0);
  });

  it("false quando setItem lança", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("x", "SecurityError");
    });
    expect(isStorageAvailable()).toBe(false);
  });
});

describe("StorageBanner", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageProbeForTests();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("não renderiza nada quando tudo está normal", () => {
    const { container } = render(<StorageBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("avisa quando o armazenamento está indisponível", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("x", "SecurityError");
    });
    render(<StorageBanner />);
    expect(screen.getByRole("alert").textContent).toContain(UNAVAILABLE);
  });

  it("avisa perto do limite (>4 MB) com link para Configurações", () => {
    localStorage.setItem("jobfind:v1:profile", "x".repeat(2_100_000));
    render(<StorageBanner />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain(NEAR_LIMIT);
    expect(screen.getByRole("link", { name: /configurações/i }).getAttribute("href")).toBe(
      "/configuracoes",
    );
  });

  it("não avisa abaixo de 4 MB", () => {
    localStorage.setItem("jobfind:v1:profile", "x".repeat(1_000_000));
    const { container } = render(<StorageBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("storage cheio na sonda (QuotaExceededError) mostra perto do limite", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("x", "QuotaExceededError");
    });
    render(<StorageBanner />);
    expect(screen.getByRole("status").textContent).toContain(NEAR_LIMIT);
    expect(screen.getByRole("link", { name: /configurações/i })).toBeTruthy();
  });

  it("acessar window.localStorage lançando (Safari privado) mostra indisponível", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new DOMException("x", "SecurityError");
    });
    render(<StorageBanner />);
    expect(screen.getByRole("alert").textContent).toContain(UNAVAILABLE);
  });

  it("evento storage da chave de sonda não gera escritas nem nova sonda", () => {
    render(<StorageBanner />);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "jobfind:probe" }));
    });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("renderizar de novo não escreve (sonda cacheada)", () => {
    const { rerender } = render(<StorageBanner />);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    rerender(<StorageBanner />);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("Store.set na mesma aba atualiza o banner sem recarregar", () => {
    render(<StorageBanner />);
    expect(screen.queryByRole("status")).toBeNull();
    const store = createStore("jobfind:v1:profile", z.string(), { version: 1, initial: "" });
    act(() => {
      store.set("x".repeat(2_100_000));
    });
    expect(screen.getByRole("status").textContent).toContain(NEAR_LIMIT);
  });
});
