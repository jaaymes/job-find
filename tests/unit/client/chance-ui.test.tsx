import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FiltersPanel } from "@/components/jobs/FiltersPanel";
import { JobDetailView } from "@/components/jobs/JobDetail";
import { useJobsWithChance } from "@/lib/client/jobs/use-jobs-with-chance";
import { profileStore } from "@/lib/client/profile/store";
import { emptyProfile } from "@/lib/shared/schemas/profile";
import type { JobDetail, JobSummary } from "@/lib/shared/types/job";

function summary(id: number, over: Partial<JobSummary> = {}): JobSummary {
  return {
    id,
    title: "Desenvolvedor React",
    company: "Acme",
    companyLogoUrl: null,
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
  });

  it("sem perfil o convite leva para /perfil", () => {
    render(<JobDetailView job={detail()} />);
    expect(screen.getByRole("link", { name: "Importe seu currículo para ver" }).getAttribute("href")).toBe("/perfil");
  });
});

describe("FiltersPanel: chance", () => {
  const props = { onClear: () => {}, open: true, id: "f" };

  it("sem perfil o filtro fica desabilitado e sugere importar o currículo", () => {
    render(<FiltersPanel {...props} filters={{}} onChange={() => {}} hasProfile={false} />);
    expect(screen.getByRole("radio", { name: "Chance: Alta" }).matches(":disabled")).toBe(true);
    expect(screen.getByRole("link", { name: "Importe seu currículo" }).getAttribute("href")).toBe("/perfil");
  });

  it("com perfil escolher Alta grava chance=['alta']", () => {
    const onChange = vi.fn();
    render(<FiltersPanel {...props} filters={{}} onChange={onChange} hasProfile />);
    fireEvent.click(screen.getByRole("radio", { name: "Chance: Alta" }));
    expect(onChange).toHaveBeenCalledWith({ chance: ["alta"] });
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
  });

  it("sem filtro (bands null) usa a URL padrão e anexa o score", async () => {
    withProfile();
    const { fetchMock, hook } = setup([{ items: [summary(1)], nextCursor: null }], null);
    await waitFor(() => expect(hook.result.current.items).toHaveLength(1));
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/jobs");
    expect(hook.result.current.items[0].chance?.band).toBe("alta");
  });
});
