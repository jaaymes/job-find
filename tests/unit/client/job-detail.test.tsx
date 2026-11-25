import { cleanup, render as rtlRender, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JobDetailView } from "@/components/jobs/JobDetail";
import { aiSettingsStore, defaultAiSettings } from "@/lib/client/ai/settings";
import { resetStorageProbeForTests } from "@/lib/client/storage/store";
import type { JobDetail } from "@/lib/shared/types/job";

const HIMALAYAS_APPLY = "https://himalayas.app/companies/acme/jobs/dev?utm_source=api";

function job(over: Partial<JobDetail> = {}): JobDetail {
  return {
    id: 1,
    title: "Desenvolvedor React",
    company: "Acme",
    companyLogoUrl: null,
    summary: "Resumo",
    country: "BR",
    city: null,
    origin: "national",
    acceptsBrazil: true,
    workMode: "remote",
    seniority: "senior",
    language: "pt",
    stacks: ["react"],
    sources: ["himalayas"],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    publishedAt: "2026-11-23T12:00:00.000Z",
    urlCanonical: "https://himalayas.app/companies/acme/jobs/dev",
    applyUrl: HIMALAYAS_APPLY,
    descriptionHtml: "<p>Descrição</p>",
    attribution: [{ source: "himalayas", label: "Himalayas", url: HIMALAYAS_APPLY, dofollow: false }],
    ...over,
  };
}

const render = (j: JobDetail) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<JobDetailView job={j} />);
  return host;
};

const applyLink = (host: HTMLElement) =>
  [...host.querySelectorAll("a")].find((a) => a.textContent?.includes("Candidatar"));

describe("JobDetailView", () => {
  it("o botão Candidatar usa a URL bruta da fonte, sem tirar o utm_source (D-07)", () => {
    const a = applyLink(render(job()));
    expect(a?.getAttribute("href")).toBe(HIMALAYAS_APPLY);
  });

  it("sem applyUrl seguro não mostra o botão", () => {
    expect(applyLink(render(job({ applyUrl: null })))).toBeUndefined();
    expect(applyLink(render(job({ applyUrl: "javascript:alert(1)" })))).toBeUndefined();
  });

  it("links externos avisam que abrem em nova aba e escondem o ↗ do leitor de tela", () => {
    const host = render(job());
    const external = [...host.querySelectorAll('a[target="_blank"]')];
    expect(external.length).toBeGreaterThanOrEqual(2);
    for (const a of external) {
      const hint = [...a.querySelectorAll(".sr-only")].find((e) => e.textContent?.includes("abre em nova aba"));
      expect(hint?.textContent?.trim()).toBe("(abre em nova aba)");
    }
    const glyph = [...applyLink(host)!.querySelectorAll("span")].find((s) => s.textContent === "↗");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("JobDetailView: aderência e barra de ação", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageProbeForTests();
    aiSettingsStore.set({
      ...defaultAiSettings(),
      providers: { openrouter: { key: "k", addedAt: "2026-01-01", source: "paste" as const } },
    });
  });
  afterEach(() => cleanup());

  it("pedido de currículo aparece uma vez no detalhe sem perfil", () => {
    rtlRender(<JobDetailView job={job()} />);
    const links = screen.getAllByRole("link", { name: /importar currículo/i });
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("/perfil?voltar=%2Fvagas%2F1");
    expect(screen.queryAllByRole("button", { name: /importar currículo/i })).toHaveLength(0);
    expect(screen.queryByText("Importe seu currículo para ver")).toBeNull();
  });

  it("Gerar CV fica desabilitado e diz o motivo sem perfil", () => {
    rtlRender(<JobDetailView job={job()} />);
    const buttons = screen.getAllByRole("button", { name: "Gerar CV + carta · precisa do currículo" });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    for (const b of buttons) expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryAllByRole("link", { name: /Gerar CV/ })).toHaveLength(0);
  });

  it("CTA Candidatar-se cabe em uma linha", () => {
    rtlRender(<JobDetailView job={job()} />);
    const ctas = screen.getAllByRole("link", { name: /Candidatar-se/ });
    expect(ctas.length).toBe(2);
    for (const a of ctas) expect(a.className).toContain("whitespace-nowrap");
    expect(ctas[0]!.textContent).toContain("Candidatar-se na Himalayas");
  });
});
