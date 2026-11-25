import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourcesPage } from "@/components/sources/SourcesPage";
import type { SourceStatus } from "@/lib/shared/types/sources-status";

const mocks = vi.hoisted(() => ({ query: {} as Record<string, unknown> }));
vi.mock("@/lib/client/sources/use-sources-status", () => ({ useSourcesStatus: () => mocks.query }));

const NOW = Date.now();
const HOUR = 3_600_000;

function source(id: string, label: string, hoursAgo: number): SourceStatus {
  return {
    source: id as SourceStatus["source"],
    label,
    attributionUrl: `https://${id}.example`,
    dofollow: false,
    status: "ok",
    lastSuccessAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
    staleAfterMinutes: 180,
    lastRun: null,
  };
}

function setSources(sources: SourceStatus[]) {
  mocks.query = { isPending: false, isError: false, data: { sources }, dataUpdatedAt: NOW, refetch: vi.fn() };
}

afterEach(cleanup);

describe("SourcesPage: coleta atrasada", () => {
  it("mostra um banner global quando todas estão atrasadas e não 1 alerta por fonte", () => {
    setSources([source("lever", "Lever", 5), source("ashby", "Ashby", 6), source("hn", "Hacker News", 9)]);
    render(<SourcesPage />);

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toMatch(/todas as fontes/i);
    expect(screen.queryByText(/Coleta parada há mais de/)).toBeNull();
  });

  it("com só algumas atrasadas mantém o aviso na própria fonte e sem banner global", () => {
    setSources([source("lever", "Lever", 0.2), source("ashby", "Ashby", 6)]);
    render(<SourcesPage />);

    expect(screen.queryByText(/todas as fontes/i)).toBeNull();
    expect(screen.getAllByText("Coleta parada há mais de 3 h")).toHaveLength(1);
  });
});
