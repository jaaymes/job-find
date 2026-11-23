import { describe, expect, it } from "vitest";
import { fetchBoardsPooled } from "@/lib/server/sources/boards";
import { collect, fakeCtx } from "./helpers";

const BOARDS = ["a", "b", "c", "d", "e", "f", "g"] as const;

describe("fetchBoardsPooled", () => {
  it("respeita o abort: para de agendar boards e relança em vez de contar como falha", async () => {
    const abort = new AbortController();
    const ctx = { ...fakeCtx({ serve: () => []}), signal: abort.signal };
    const started: string[] = [];
    const run = collect(
      fetchBoardsPooled(ctx, "Teste", BOARDS, async (board) => {
        started.push(board);
        if (started.length === 3) abort.abort(new Error("cancelado"));
        await new Promise((r) => setTimeout(r, 5));
        throw new Error("falha de rede causada pelo abort");
      }),
    );
    await expect(run).rejects.toThrow("cancelado");
    expect(started.length).toBeLessThan(BOARDS.length);
  });

  it("não inicia nenhum board se o signal já chegou abortado", async () => {
    const abort = new AbortController();
    abort.abort(new Error("cancelado"));
    const ctx = { ...fakeCtx({ serve: () => []}), signal: abort.signal };
    let calls = 0;
    await expect(
      collect(fetchBoardsPooled(ctx, "Teste", BOARDS, async () => { calls++; return []; })),
    ).rejects.toThrow("cancelado");
    expect(calls).toBe(0);
  });

  it("ignora boards que falham, mas lança se todos falharem", async () => {
    const ctx = fakeCtx({ serve: () => []});
    const some = await collect(
      fetchBoardsPooled(ctx, "Teste", BOARDS, async (b) => {
        if (b !== "c") throw new Error("x");
        return [1, 2];
      }),
    );
    expect(some).toEqual([1, 2]);
    await expect(
      collect(fetchBoardsPooled(ctx, "Teste", BOARDS, async () => { throw new Error("x"); })),
    ).rejects.toThrow("Teste: todos os boards falharam");
  });
});
