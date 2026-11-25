import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { ChanceBadge } from "@/components/jobs/ChanceBadge";
import { FiltersPanel } from "@/components/jobs/FiltersPanel";
import { JobsPage } from "@/components/jobs/JobsPage";
import { aiSettingsStore, defaultAiSettings } from "@/lib/client/ai/settings";
import { JobDetailView } from "@/components/jobs/JobDetail";
import { useJobsWithChance } from "@/lib/client/jobs/use-jobs-with-chance";
import { profileStore } from "@/lib/client/profile/store";
import { emptyProfile } from "@/lib/shared/schemas/profile";
import type { JobDetail, JobSummary } from "@/lib/shared/types/job";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));

function summary(id: number, over: Partial<JobSummary> = {}): JobSummary {
  return {
    id,
    title: "Desenvolvedor React",
    company: "Acme",
    companyLogoUrl: null,
    urlCanonical: `https://x.test/${id}`,
    summary: "",
    country: "BR",
    city: null,
    origin: "national",
    acceptsBrazil: true,
    workMode: "remote",
    seniority: "senior",
    language: "pt",
    stacks: ["react"],
    sources: ["greenhouse"],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    publishedAt: new Date().toISOString(),
    ...over,
  };
}

const detail = (): JobDetail => ({
  ...summary(1),
  urlCanonical: "https://x.test/1",
  applyUrl: null,
  descriptionHtml: "<p>Texto</p>",
  attribution: [],
});

const withProfile = () =>
  profileStore.set({
    ...emptyProfile(),
    seniority: "senior",
    englishLevel: "advanced",
    skills: [{ name: "React", years: 5, stackId: "react" }],
  });

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("JobDetailView: Sua chance", () => {
  it("no pré-render (sem hidratação) mostra o estado neutro, sem score", () => {
    withProfile();
    const html = renderToStaticMarkup(<JobDetailView job={detail()} />);
    expect(html).toContain("Importe seu currículo para ver");
    expect(html).not.toContain("Detalhes da nota");
  });

  it("com perfil salvo mostra a faixa, o percentual e o breakdown", async () => {
    withProfile();
    render(<JobDetailView job={detail()} />);
    const list = await screen.findByRole("list", { name: "Detalhes da nota" });
    expect(list.querySelectorAll("li")).toHaveLength(5);
    expect(screen.getByText("Alta · 100%")).toBeTruthy();
    expect(screen.getByText("Tecnologias")).toBeTruthy();
    // Peso efetivo (stack 45 de 100) e nunca o nominal.
    expect(list.textContent).toContain("peso 45%");
    expect(list.textContent).not.toMatch(/peso \d+(?!%)\b(?!%)\s*$/);
  });

  it("sem perfil o convite leva para /perfil", () => {
    render(<JobDetailView job={detail()} />);
    expect(screen.getByRole("link", { name: "Importe seu currículo para ver" }).getAttribute("href")).toBe("/perfil");
  });
});

describe("ChanceBadge", () => {
  it("ChanceBadge com band null não renderiza", () => {
    const { container } = render(<ChanceBadge band={null} />);
    expect(container.textContent).toBe("");
  });
});

describe("JobsPage sem perfil", () => {
  it("lista sem perfil mostra exatamente 1 convite de importar", async () => {
    aiSettingsStore.set({
      ...defaultAiSettings(),
      providers: { openrouter: { key: "k", addedAt: "2026-01-01", source: "paste" as const } },
    });
    const items = [summary(1), summary(2), summary(3)];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ items, nextCursor: null, lastCollectedAt: null })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <NuqsTestingAdapter>
        <QueryClientProvider client={client}>
          <JobsPage />
        </QueryClientProvider>
      </NuqsTestingAdapter>,
    );
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(3));
    expect(screen.getAllByText(/importar currículo/i)).toHaveLength(1);
    expect(screen.queryByText("Importe seu currículo para ver")).toBeNull();
  });
});

describe("FiltersPanel: chance", () => {
  const props = {
    onClear: () => {},
    id: "f",
    savedSearch: { active: false, canSave: false, error: null, onSave: () => {}, onClear: () => {} },
  };

  it("sem perfil o grupo Chance vira uma linha de convite, sem rádios nem link repetido", () => {
    render(<FiltersPanel {...props} filters={{}} onChange={() => {}} hasProfile={false} />);
    expect(screen.queryByRole("radio", { name: "Chance: Alta" })).toBeNull();
    expect(screen.getByText(/Filtro de chance disponível depois de importar o currículo/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /currículo/i })).toBeNull();
  });

  it("com perfil escolher Alta grava chance=['alta']", () => {
    const onChange = vi.fn();
    render(<FiltersPanel {...props} filters={{}} onChange={onChange} hasProfile />);
    fireEvent.click(screen.getByRole("radio", { name: "Chance: Alta" }));
    expect(onChange).toHaveBeenCalledWith({ chance: ["alta"] });
  });
});

describe("FiltersPanel: fonte", () => {
  const props = {
    onClear: () => {},
    id: "f",
    savedSearch: { active: false, canSave: false, error: null, onSave: () => {}, onClear: () => {} },
  };

  it("lista só fontes com conector ativo", () => {
    render(<FiltersPanel {...props} filters={{}} onChange={() => {}} hasProfile={false} />);
    const select = screen.getByRole("combobox", { name: /Fonte/ });
    const labels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toContain("Greenhouse");
    expect(labels).toContain("4 Day Week");
    expect(labels).toContain("Get on Board");
    expect(labels).toContain("SmartRecruiters");
  });
});

describe("useJobsWithChance", () => {
  function setup(pages: { items: JobSummary[]; nextCursor: string | null }[], bands: ("alta" | "media" | "baixa")[] | null) {
    const queue = [...pages];
    const fetchMock = vi.fn(async () => Response.json({ ...queue.shift(), lastCollectedAt: null }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useJobsWithChance({}, bands), { wrapper });
    return { fetchMock, hook };
  }
  const low = (id: number) => summary(id, { stacks: ["vue"], seniority: "junior" });

  it("com filtro pede limit=90 e para em 5 requisições quando nada casa", async () => {
    withProfile();
    const pages = Array.from({ length: 8 }, (_, i) => ({ items: [low(i)], nextCursor: `c${i + 1}` }));
    const { fetchMock, hook } = setup(pages, ["alta"]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/jobs?limit=90");
    expect(hook.result.current.items).toEqual([]);
    expect(hook.result.current.hasMore).toBe(true);
  });

  it("para assim que reúne 30 itens e mantém a ordem da API", async () => {
    withProfile();
    const good = (id: number) => summary(id);
    const p1 = { items: Array.from({ length: 20 }, (_, i) => good(i)), nextCursor: "c1" };
    const p2 = { items: Array.from({ length: 20 }, (_, i) => good(100 + i)), nextCursor: "c2" };
    const { fetchMock, hook } = setup([p1, p2, { items: [good(999)], nextCursor: null }], ["alta"]);
    await waitFor(() => expect(hook.result.current.items).toHaveLength(30));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const ids = hook.result.current.items.map((x) => x.job.id);
    expect(ids).toEqual([...Array(20).keys(), ...Array.from({ length: 10 }, (_, i) => 100 + i)]);
  });

  it("sem perfil ignora o filtro e não busca páginas extras", async () => {
    const { fetchMock, hook } = setup([{ items: [low(1), low(2)], nextCursor: "c1" }], ["alta"]);
    await waitFor(() => expect(hook.result.current.items).toHaveLength(2));
    expect(hook.result.current.items.every((x) => x.chance === null)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/jobs");
  });

  it("erro numa página não gera laço de requisições e expõe o erro", async () => {
    withProfile();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useJobsWithChance({}, ["alta"]), { wrapper });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    await new Promise((r) => setTimeout(r, 200));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.isFetchingNextPage).toBe(false);
  });

  it("erro na segunda página: para, mostra o erro e retryNext refaz só essa página", async () => {
    withProfile();
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      if (calls === 1) return Response.json({ items: [low(1)], nextCursor: "c1", lastCollectedAt: null });
      if (calls === 2) return new Response("{}", { status: 503 });
      return Response.json({ items: Array.from({ length: 30 }, (_, i) => summary(100 + i)), nextCursor: null, lastCollectedAt: null });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useJobsWithChance({}, ["alta"]), { wrapper });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    await new Promise((r) => setTimeout(r, 200));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    act(() => hook.result.current.retryNext());
    await waitFor(() => expect(hook.result.current.items).toHaveLength(30));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("sem filtro (bands null) usa a URL padrão e anexa o score", async () => {
    withProfile();
    const { fetchMock, hook } = setup([{ items: [summary(1)], nextCursor: null }], null);
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/jobs");
    expect(hook.result.current.items[0].chance?.band).toBe("alta");
  });
});
