import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { PageFilters } from "@/lib/client/jobs/use-jobs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RestoredNotice, clearRestoredSearch, useRestoredNoticeVisible } from "@/components/jobs/RestoredNotice";

afterEach(() => cleanup());

describe("RestoredNotice", () => {
  it("avisa que a busca da última visita foi restaurada", () => {
    render(<RestoredNotice visible onClear={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("Busca da última visita restaurada");
  });

  it("o botão Limpar chama onClear", () => {
    const onClear = vi.fn();
    render(<RestoredNotice visible onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("o botão Limpar tem alvo de toque de 44 px em qualquer largura", () => {
    render(<RestoredNotice visible onClear={() => {}} />);
    const classes = screen.getByRole("button", { name: "Limpar" }).className.split(/\s+/);
    expect(classes).toContain("min-h-11");
    expect(classes.filter((c) => /^\w+:min-h-/.test(c))).toEqual([]);
  });

  it("clearRestoredSearch zera também a busca por texto (q), mesmo quando ela é o único filtro", () => {
    const set = vi.fn();
    clearRestoredSearch(set);
    const patch = set.mock.calls[0][0] as Record<string, unknown>;
    expect("q" in patch && patch.q === undefined).toBe(true);
    expect(Object.values(patch).every((v) => v === undefined)).toBe(true);
  });
});

describe("RestoredNotice: região de status", () => {
  it("o role=status existe vazio na montagem e só depois recebe o texto", () => {
    const html = renderToString(<RestoredNotice visible onClear={() => {}} />);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("Busca da última visita restaurada");
    render(<RestoredNotice visible onClear={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("Busca da última visita restaurada");
  });

  it("invisível: o status continua no DOM, vazio e sem botão", () => {
    render(<RestoredNotice visible={false} onClear={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Limpar" })).toBeNull();
  });
});

describe("useRestoredNoticeVisible", () => {
  const setup = (initial: PageFilters, restored: "last" | "saved" | null = "last") =>
    renderHook(({ f }) => useRestoredNoticeVisible(f, restored, true), { initialProps: { f: initial } });

  it("aparece com a busca restaurada e some ao mudar um filtro", () => {
    const { result, rerender } = setup({ lang: "pt" });
    expect(result.current).toBe(true);
    rerender({ f: { lang: "en" } });
    expect(result.current).toBe(false);
  });

  it("depois de mudar um filtro e voltar ao valor restaurado, o aviso não reaparece", () => {
    const { result, rerender } = setup({ lang: "pt" });
    rerender({ f: { lang: "en" } });
    rerender({ f: { lang: "pt" } });
    expect(result.current).toBe(false);
  });

  it("alternar ocultas não esconde o aviso", () => {
    const { result, rerender } = setup({ lang: "pt" });
    rerender({ f: { lang: "pt", showHidden: true } });
    expect(result.current).toBe(true);
  });

  it("busca padrão restaurada não mostra o aviso", () => {
    expect(setup({ lang: "pt" }, "saved").result.current).toBe(false);
  });
});
