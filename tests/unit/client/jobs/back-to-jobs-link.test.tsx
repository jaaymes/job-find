import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackToJobsLink } from "@/components/jobs/BackToJobsLink";
import { markListReturn } from "@/lib/client/jobs/list-href";
import { lastFiltersStore } from "@/lib/client/jobs/saved-search";

const back = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ back }) }));

beforeEach(() => {
  back.mockClear();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.pushState({}, "", "/vagas/5");
  lastFiltersStore.set({ filters: { workMode: "remote" }, savedAt: new Date().toISOString() });
});
afterEach(() => cleanup());

function setup() {
  render(<BackToJobsLink jobId={5}>Voltar para as vagas</BackToJobsLink>);
  return screen.getByRole("link", { name: "Voltar para as vagas" });
}

describe("BackToJobsLink", () => {
  it("veio da lista: volta pelo histórico e o href é o da última busca", () => {
    markListReturn(5);
    const link = setup();
    expect(link.getAttribute("href")).toBe("/?workMode=remote");
    expect(window.history.length).toBeGreaterThan(1);
    fireEvent.click(link);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("sem marca da lista, segue o link", () => {
    fireEvent.click(setup());
    expect(back).not.toHaveBeenCalled();
  });

  it("marca de outra vaga, segue o link", () => {
    markListReturn(7);
    fireEvent.click(setup());
    expect(back).not.toHaveBeenCalled();
  });

  it("com ctrl, deixa o navegador abrir o link", () => {
    markListReturn(5);
    fireEvent.click(setup(), { ctrlKey: true });
    expect(back).not.toHaveBeenCalled();
  });
});
