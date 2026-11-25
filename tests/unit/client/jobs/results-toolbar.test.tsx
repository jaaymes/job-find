import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NuqsTestingAdapter, type OnUrlUpdateFunction } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveFilterChips, buildActiveChips } from "@/components/jobs/ActiveFilterChips";
import { JobsPage } from "@/components/jobs/JobsPage";
import { ResultsToolbar } from "@/components/jobs/ResultsToolbar";
import type { JobSummary } from "@/lib/shared/types/job";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

function summary(id: number): JobSummary {
  return {
    id,
    title: `Desenvolvedor ${id}`,
    company: "Acme",
    companyLogoUrl: null,
    urlCanonical: `https://x.test/${id}`,
    summary: "",
    country: "BR",
    city: null,
    origin: "national",
    acceptsBrazil: true,
    workMode: "remote",
    seniority: "mid",
    language: "pt",
    stacks: ["react"],
    sources: ["greenhouse"],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    publishedAt: new Date().toISOString(),
  };
}

/** `matchMedia` controlável: `setLg(true)` dispara `change` nos ouvintes da consulta de `lg`. */
function stubViewport() {
  let lg = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return query === "(min-width: 1024px)" ? lg : false;
      },
      media: query,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })),
  );
  return {
    setLg(value: boolean) {
      lg = value;
      act(() => listeners.forEach((fn) => fn()));
    },
  };
}

function renderPage(searchParams: string, items: JobSummary[], onUrlUpdate?: OnUrlUpdateFunction) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        items,
        nextCursor: null,
        counts: { all: 1284, remote: 800, hybrid: 300, onsite: 184 },
        lastCollectedAt: null,
      }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      <QueryClientProvider client={client}>
        <JobsPage />
      </QueryClientProvider>
    </NuqsTestingAdapter>,
  );
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ResultsToolbar", () => {
  it("mostra Filtros (2) e 1.284 vagas", () => {
    render(<ResultsToolbar activeCount={2} total={1284} onOpenFilters={() => {}} />);
    expect(screen.getByRole("button", { name: "Filtros (2)" })).toBeTruthy();
    expect(screen.getByText("1.284 vagas")).toBeTruthy();
  });

  it("sem filtros ativos o botão é só Filtros, e 1 vaga fica no singular", () => {
    render(<ResultsToolbar activeCount={0} total={1} onOpenFilters={() => {}} />);
    expect(screen.getByRole("button", { name: "Filtros" })).toBeTruthy();
    expect(screen.getByText("1 vaga")).toBeTruthy();
  });

  it("clicar em Filtros chama onOpenFilters", () => {
    const onOpen = vi.fn();
    render(<ResultsToolbar activeCount={0} total={null} onOpenFilters={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe("ActiveFilterChips", () => {
  it("remove um filtro pelo chip e limpa tudo", () => {
    const onChange = vi.fn();
    const onClearAll = vi.fn();
    const chips = buildActiveChips({ seniority: ["mid", "senior"], origin: "national" }, onChange, true);
    render(<ActiveFilterChips chips={chips} onClearAll={onClearAll} />);
    expect(screen.getByText("Pleno, Sênior")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remover filtro: Pleno, Sênior" }));
    expect(onChange).toHaveBeenCalledWith({ seniority: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Limpar tudo" }));
    expect(onClearAll).toHaveBeenCalledOnce();
  });

  it("alvos de toque dos chips têm 44px (min-h-11 e min-w-11) abaixo de md", () => {
    const chips = buildActiveChips({ origin: "national" }, () => {}, true);
    render(<ActiveFilterChips chips={chips} onClearAll={() => {}} />);
    const remove = screen.getByRole("button", { name: "Remover filtro: Nacional" });
    expect(remove.className).toContain("min-h-11");
    expect(remove.className).toContain("min-w-11");
    expect(screen.getByRole("button", { name: "Limpar tudo" }).className).toContain("min-h-11");
  });

  it("sem chips não renderiza nada", () => {
    const { container } = render(<ActiveFilterChips chips={[]} onClearAll={() => {}} />);
    expect(container.textContent).toBe("");
  });
});

describe("JobsPage: filtros", () => {
  it("Limpar filtros mantém a busca", async () => {
    stubViewport();
    const updates: string[] = [];
    renderPage("?q=react&seniority=mid", [], ({ queryString }) => updates.push(queryString));
    fireEvent.click(await screen.findByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(updates.length).toBeGreaterThan(0));
    const last = new URLSearchParams(updates[updates.length - 1]);
    expect(last.get("q")).toBe("react");
    expect(last.has("seniority")).toBe(false);
  });

  it("rodapé do sheet mostra Ver N vagas com contagem ao vivo", async () => {
    stubViewport();
    renderPage("?seniority=mid&origin=national", [summary(1), summary(2)]);
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Filtros (2)" }));
    const dialog = await screen.findByRole("dialog", { name: "Filtros" });
    expect(dialog.textContent).toContain("Publicadas");
    expect(screen.getByRole("button", { name: "Ver 1.284 vagas" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ver 1.284 vagas" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sheet de filtros fecha quando lg passa a valer", async () => {
    const viewport = stubViewport();
    renderPage("", [summary(1)]);
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    await screen.findByRole("dialog", { name: "Filtros" });
    expect(screen.queryByRole("complementary", { name: "Filtros" })).toBeNull();

    viewport.setLg(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("complementary", { name: "Filtros" })).toBeTruthy();
  });
});
