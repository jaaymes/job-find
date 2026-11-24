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
    expect(ctx.partials).toEqual([]); // abort não é falha de board
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
    // Cada board que falhou fica registrado para o runner (falha parcial), com o erro original.
    expect(ctx.partials.map((p) => p.label).sort()).toEqual(["a", "b", "d", "e", "f", "g"]);
    expect(ctx.partials.every((p) => p.error instanceof Error && p.error.message === "x")).toBe(true);
    await expect(
      collect(fetchBoardsPooled(ctx, "Teste", BOARDS, async () => { throw new Error("x"); })),
    ).rejects.toThrow("Teste: todos os boards falharam");
  });

  it("começa no board do cursor e dá a volta", async () => {
    const ctx = fakeCtx({ serve: () => [], cursor: "5" });
    const called: string[] = [];
    await collect(
      fetchBoardsPooled(ctx, "Teste", BOARDS, async (b) => {
        called.push(b);
        return [b];
      }),
    );
    expect(called).toEqual(["f", "g", "a", "b", "c", "d", "e"]);
    expect(ctx.cursors).toEqual(["5"]);
  });

  it("para de agendar perto do prazo e grava onde parou", async () => {
    const ctx = fakeCtx({ serve: () => [], deadlineAt: Date.now() + 4_000 });
    const called: string[] = [];
    await collect(
      fetchBoardsPooled(ctx, "Teste", BOARDS, async (b) => {
        called.push(b);
        return [b];
      }),
    );
    expect(called).toEqual(["a"]);
    expect(ctx.cursors).toEqual(["1"]);
  });

  it.each(["abc", "-1", "99"])("cursor inválido %s recomeça do zero", async (cursor) => {
    const ctx = fakeCtx({ serve: () => [], cursor });
    const called: string[] = [];
    await collect(
      fetchBoardsPooled(ctx, "Teste", BOARDS, async (b) => {
        called.push(b);
        return [];
      }),
    );
    expect(called[0]).toBe("a");
  });

  it("board com lista vazia ou com falha fica fora do escopo", async () => {
    const ctx = fakeCtx({ serve: () => [] });
    await collect(
      fetchBoardsPooled(ctx, "Teste", ["a", "b", "c"], async (b) => {
        if (b === "a") return [1];
        if (b === "b") return [];
        throw new Error("x");
      }),
    );
    expect(ctx.scopes.flat()).toEqual(["a:"]);
  });

  it("usa scopePrefix customizado", async () => {
    const ctx = fakeCtx({ serve: () => [] });
    await collect(
      fetchBoardsPooled(ctx, "Teste", ["o/r"], async () => [1], { scopePrefix: (r) => `${r}#` }),
    );
    expect(ctx.scopes.flat()).toEqual(["o/r#"]);
  });

  it("prazo vencido ainda tenta 1 board e não lança 'todos falharam'", async () => {
    const ctx = fakeCtx({ serve: () => [], deadlineAt: Date.now() - 1 });
    let calls = 0;
    await expect(
      collect(
        fetchBoardsPooled(ctx, "Teste", BOARDS, async () => {
          calls++;
          return [];
        }),
      ),
    ).resolves.toEqual([]);
    expect(calls).toBe(1);
    expect(ctx.cursors).toEqual(["1"]);
  });

  it("janela inteira falha: lança, mas o cursor avança para o board seguinte", async () => {
    const ctx = fakeCtx({ serve: () => [], cursor: "2", deadlineAt: Date.now() - 1 });
    await expect(
      collect(fetchBoardsPooled(ctx, "Teste", BOARDS, async () => { throw new Error("x"); })),
    ).rejects.toThrow("Teste: todos os boards falharam");
    expect(ctx.cursors).toEqual(["3"]);
  });
});
