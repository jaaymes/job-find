import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Board, STAGES } from "@/components/my-jobs/Board";
import { jobStateStore, type JobState, type JobStatus } from "@/lib/client/jobs/job-state";

function job(id: number, status: JobStatus, favorite = false, hidden = false): JobState {
  return {
    favorite,
    hidden,
    status,
    statusHistory: [],
    snapshot: {
      id,
      title: `Vaga ${id}`,
      company: "Acme",
      urlCanonical: null,
      stacks: [],
      workMode: "remote",
      publishedAt: `2026-01-0${id}T00:00:00Z`,
    },
  };
}

const column = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  localStorage.clear();
  act(() => {
    jobStateStore.set({
      "1": job(1, "saved"),
      "2": job(2, "none", true),
      "3": job(3, "applied", true),
      "4": job(4, "interview"),
      "5": job(5, "rejected"),
      "6": job(6, "none", false, true),
    });
  });
});
afterEach(cleanup);

describe("Board (funil)", () => {
  it("desktop mostra 4 colunas com contadores", () => {
    render(<Board />);
    expect(STAGES.map((s) => s.label)).toEqual(["Salvas", "Aplicadas", "Entrevista", "Proposta"]);
    for (const [name, n] of [["Salvas", 2], ["Aplicadas", 1], ["Entrevista", 1], ["Proposta", 0]] as const) {
      const col = column(name);
      expect(within(col).getByRole("heading", { level: 2, name }).nextElementSibling?.textContent).toBe(String(n));
    }
    expect(screen.getByRole("button", { name: "Recusadas (1)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ocultas (1)" })).toBeTruthy();
  });

  it("Só favoritas filtra as 4 colunas", () => {
    render(<Board />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Só favoritas" }));
    expect(within(column("Salvas")).getAllByRole("article")).toHaveLength(1);
    expect(within(column("Aplicadas")).getAllByRole("article")).toHaveLength(1);
    expect(within(column("Entrevista")).queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Recusadas (0)" })).toBeTruthy();
  });

  it("coluna vazia mostra o texto de ajuda", () => {
    render(<Board />);
    expect(within(column("Proposta")).getByText(/Nenhuma proposta ainda/)).toBeTruthy();
  });

  it("celular: seletor segmentado troca a etapa e o botão Mover abre os status", async () => {
    render(<Board />);
    const tabs = screen.getByRole("tablist", { name: "Etapa" });
    expect(within(tabs).getAllByRole("tab")).toHaveLength(4);
    expect(within(tabs).getByRole("tab", { name: /Salvas/ }).getAttribute("aria-selected")).toBe("true");
    expect(column("Aplicadas").className).toContain("hidden lg:flex");

    fireEvent.click(within(tabs).getByRole("tab", { name: /Aplicadas/ }));
    expect(within(tabs).getByRole("tab", { name: /Aplicadas/ }).getAttribute("aria-selected")).toBe("true");
    expect(column("Aplicadas").className).not.toContain("hidden");
    fireEvent.keyDown(within(tabs).getByRole("tab", { name: /Aplicadas/ }), { key: "End" });
    expect(within(tabs).getByRole("tab", { name: /Proposta/ }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(within(tabs).getByRole("tab", { name: /Proposta/ }), { key: "Home" });
    expect(within(tabs).getByRole("tab", { name: /Salvas/ }).getAttribute("aria-selected")).toBe("true");

    const trigger = within(column("Salvas")).getAllByRole("button", { name: /^Mover/ })[0];
    expect(trigger.className).toContain("min-h-11");
    await act(async () => {
      fireEvent.keyDown(trigger, { key: "Enter" });
      fireEvent.click(trigger);
    });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getAllByRole("menuitemradio").map((i) => i.textContent)).toEqual([
      "Sem status", "Salva", "Aplicada", "Entrevista", "Proposta", "Recusada",
    ]);
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitemradio", { name: "Proposta" }));
    });
    expect(within(column("Proposta")).getAllByRole("article")).toHaveLength(1);
  });

  it("Recusadas e Ocultas abrem a lista filtrada na mesma tela", () => {
    render(<Board />);
    fireEvent.click(screen.getByRole("button", { name: "Ocultas (1)" }));
    expect(within(column("Ocultas")).getAllByRole("article")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao funil" }));
    expect(column("Salvas")).toBeTruthy();
  });
});
