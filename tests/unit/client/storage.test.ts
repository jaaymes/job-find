import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createStore, storageUsageBytes } from "@/lib/client/storage/store";

const KEY = "jobfind:v1:profile" as const;
const schema = z.object({ a: z.number() }).strict();
const make = (extra: { migrations?: Record<number, (old: unknown) => unknown> } = {}) =>
  createStore(KEY, schema, { version: 1, initial: { a: 0 }, ...extra });

describe("createStore", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("devolve initial quando não há nada gravado", () => {
    expect(make().get()).toEqual({ a: 0 });
  });

  it("grava e lê no formato { v, data }", () => {
    const s = make();
    expect(s.set({ a: 5 })).toEqual({ ok: true });
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ v: 1, data: { a: 5 } });
    expect(s.get()).toEqual({ a: 5 });
  });

  it("dados com chave desconhecida caem para initial (strict) sem poluir o protótipo", () => {
    const s = make();
    localStorage.setItem(KEY, '{"v":1,"data":{"a":1,"__proto__":{"x":1}}}');
    expect(s.get()).toEqual({ a: 0 });
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    localStorage.setItem(KEY, JSON.stringify({ v: 1, data: { a: 1, extra: true } }));
    expect(make().get()).toEqual({ a: 0 });
  });

  it("JSON corrompido ou versão futura caem para initial", () => {
    localStorage.setItem(KEY, "{nao-json");
    expect(make().get()).toEqual({ a: 0 });
    localStorage.setItem(KEY, JSON.stringify({ v: 2, data: { a: 1 } }));
    expect(make().get()).toEqual({ a: 0 });
  });

  it("aplica migrações em cadeia", () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 0, data: { b: 2 } }));
    const s = make({ migrations: { 0: (o) => ({ a: (o as { b: number }).b }) } });
    expect(s.get()).toEqual({ a: 2 });
  });

  it("get() é estável enquanto o valor bruto não muda", () => {
    const s = make();
    s.set({ a: 1 });
    expect(s.get()).toBe(s.get());
    expect(make().get()).toEqual({ a: 1 });
    const initialRef = createStore("jobfind:v1:ai", schema, { version: 1, initial: { a: 0 } });
    expect(initialRef.get()).toBe(initialRef.get());
  });

  it("set notifica subscribers da mesma aba e respeita unsubscribe", () => {
    const s = make();
    const cb = vi.fn();
    const off = s.subscribe(cb);
    s.set({ a: 1 });
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    s.set({ a: 2 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("evento storage de outra aba notifica apenas para a chave da store", () => {
    const s = make();
    const cb = vi.fn();
    const off = s.subscribe(cb);
    window.dispatchEvent(new StorageEvent("storage", { key: "jobfind:v1:ai" }));
    expect(cb).not.toHaveBeenCalled();
    localStorage.setItem(KEY, JSON.stringify({ v: 1, data: { a: 9 } }));
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(s.get()).toEqual({ a: 9 });
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(cb).toHaveBeenCalledTimes(2);
    off();
  });

  it("cota excedida devolve reason quota", () => {
    const s = make();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("", "QuotaExceededError");
    });
    expect(s.set({ a: 3 })).toEqual({ ok: false, reason: "quota" });
  });

  it("storage indisponível devolve initial e reason unavailable", () => {
    const s = make();
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(s.get()).toEqual({ a: 0 });
    expect(s.set({ a: 1 })).toEqual({ ok: false, reason: "unavailable" });
    expect(storageUsageBytes()).toBe(0);
  });
});

describe("storageUsageBytes", () => {
  beforeEach(() => localStorage.clear());
  it("soma apenas chaves jobfind: (chave + valor, 2 bytes por caractere)", () => {
    localStorage.setItem("outro", "xxxxxxxx");
    expect(storageUsageBytes()).toBe(0);
    localStorage.setItem("jobfind:v1:ai", "abc");
    expect(storageUsageBytes()).toBe(("jobfind:v1:ai".length + 3) * 2);
  });
});
