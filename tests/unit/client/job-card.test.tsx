import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JobCard } from "@/components/jobs/JobCard";
import type { JobSummary } from "@/lib/shared/types/job";

vi.mock("sonner", () => ({ toast: vi.fn() }));

const job: JobSummary = {
  id: 7,
  title: "Desenvolvedor React",
  company: "Acme",
  companyLogoUrl: null,
  urlCanonical: "https://x.test/7",
  summary: "",
  country: "BR",
  city: null,
  origin: "national",
  acceptsBrazil: true,
  workMode: "remote",
  seniority: "senior",
  language: "pt",
  stacks: ["react", "nodejs", "typescript"],
  sources: ["greenhouse"],
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
  publishedAt: new Date().toISOString(),
};

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

async function openMenu() {
  const trigger = screen.getByRole("button", { name: /^Mais ações/ });
  await act(async () => {
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(trigger);
  });
  return trigger;
}

describe("JobCard", () => {
  it("card tem um só link e ele cobre o card", () => {
    render(<JobCard job={job} now={Date.now()} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].className).toContain("after:absolute");
    expect(links[0].className).toContain("after:inset-0");
  });

  it("só a estrela e o menu ficam visíveis", () => {
    render(<JobCard job={job} now={Date.now()} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: /^Favoritar/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Mais ações/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Ocultar/ })).toBeNull();
  });

  it("no celular limita os chips a 3 e resume o resto em +n", () => {
    render(<JobCard job={job} now={Date.now()} />);
    // remoto, sênior, português, React, Node.js, TypeScript = 6 chips; 3 ficam no celular.
    expect(screen.getByText("+3")).toBeTruthy();
    expect(screen.getByText("React").className).toContain("hidden sm:inline");
    expect(screen.getByText("Remoto").className).not.toContain("hidden");
  });

  it("menu ⋯ oferece Mudar status, Ocultar vaga e Copiar link", async () => {
    render(<JobCard job={job} now={Date.now()} />);
    await openMenu();
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Mudar status" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Ocultar vaga" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Copiar link" })).toBeTruthy();
  });

  it("Ocultar vaga pelo menu avisa a tela (que mostra o Desfazer)", async () => {
    const onHidden = vi.fn();
    render(<JobCard job={job} now={Date.now()} onHidden={onHidden} />);
    await openMenu();
    const item = await screen.findByRole("menuitem", { name: "Ocultar vaga" });
    await act(async () => {
      fireEvent.click(item);
    });
    expect(onHidden).toHaveBeenCalledWith(job);
    expect(JSON.parse(window.localStorage.getItem("jobfind:v1:jobState")!).data["7"].hidden).toBe(true);
  });
});
