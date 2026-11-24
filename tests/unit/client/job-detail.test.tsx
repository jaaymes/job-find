import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JobDetailView } from "@/components/jobs/JobDetail";
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
      const hint = a.querySelector(".sr-only");
      expect(hint?.textContent?.trim()).toBe("(abre em nova aba)");
    }
    const glyph = [...applyLink(host)!.querySelectorAll("span")].find((s) => s.textContent === "↗");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
  });
});
