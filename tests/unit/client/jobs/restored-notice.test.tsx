import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RestoredNotice, clearRestoredSearch } from "@/components/jobs/RestoredNotice";

afterEach(() => cleanup());

describe("RestoredNotice", () => {
  it("avisa que a busca da última visita foi restaurada", () => {
    render(<RestoredNotice onClear={() => {}} />);
    expect(screen.getByRole("status").textContent).toContain("Busca da última visita restaurada");
  });

  it("o botão Limpar chama onClear", () => {
    const onClear = vi.fn();
    render(<RestoredNotice onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: "Limpar" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("clearRestoredSearch zera também a busca por texto (q), mesmo quando ela é o único filtro", () => {
    const set = vi.fn();
    clearRestoredSearch(set);
    const patch = set.mock.calls[0][0] as Record<string, unknown>;
    expect("q" in patch && patch.q === undefined).toBe(true);
    expect(Object.values(patch).every((v) => v === undefined)).toBe(true);
  });
});
