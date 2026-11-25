import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

afterEach(cleanup);

function setup() {
  render(
    <Sheet>
      <SheetTrigger>Abrir filtros</SheetTrigger>
      <SheetContent title="Filtros" description="Refine as vagas" footer={<button type="button">Aplicar</button>}>
        <p>Conteúdo</p>
      </SheetContent>
    </Sheet>,
  );
}

describe("Sheet", () => {
  it("abre pelo trigger com role dialog e nome acessível do title", async () => {
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Abrir filtros"));
    const dialog = await screen.findByRole("dialog", { name: "Filtros" });
    expect(dialog).toBeTruthy();
  });

  it("Esc fecha e devolve o foco ao trigger", async () => {
    setup();
    const trigger = screen.getByText("Abrir filtros");
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("footer fica fora da área rolável", async () => {
    setup();
    fireEvent.click(screen.getByText("Abrir filtros"));
    await screen.findByRole("dialog");
    const body = document.querySelector("[data-sheet-body]");
    const footer = screen.getByText("Aplicar");
    expect(body).not.toBeNull();
    expect(body!.contains(footer)).toBe(false);
    expect(body!.contains(screen.getByText("Conteúdo"))).toBe(true);
  });

  it("fechar tem 44px", async () => {
    setup();
    fireEvent.click(screen.getByText("Abrir filtros"));
    await screen.findByRole("dialog");
    const close = screen.getByRole("button", { name: "Fechar" });
    expect(close.className).toContain("size-11");
  });
});
