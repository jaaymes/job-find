import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RestoredNotice } from "@/components/jobs/RestoredNotice";

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
});
