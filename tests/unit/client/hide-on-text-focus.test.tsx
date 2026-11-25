import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileActionBar } from "@/components/generator/GeneratorScreen";
import { HIDE_ON_TEXT_FOCUS } from "@/components/layout/hide-on-text-focus";
import { JobDetailActionBar } from "@/components/jobs/JobDetailActionBar";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/" }));

afterEach(cleanup);

describe("HIDE_ON_TEXT_FOCUS", () => {
  it("só casa campo de texto: exclui checkbox, radio e select", () => {
    expect(HIDE_ON_TEXT_FOCUS).toContain("input:focus:not([type=checkbox],[type=radio]");
    expect(HIDE_ON_TEXT_FOCUS).toContain("textarea:focus");
    expect(HIDE_ON_TEXT_FOCUS).not.toContain("select");
  });

  it("a barra de ação da vaga usa o seletor compartilhado", () => {
    render(
      <JobDetailActionBar
        jobId={1}
        job={{ id: 1, title: "Dev", company: "Acme", urlCanonical: null, stacks: [], workMode: "remote", publishedAt: "2026-01-01T00:00:00Z" }}
        applyUrl=""
        sourceName="Fonte"
        canGenerate
      />,
    );
    const bar = screen.getByRole("group", { name: "Ações da vaga" });
    expect(bar.className).toContain(HIDE_ON_TEXT_FOCUS);
    expect(bar.className).toContain("md:hidden");
  });

  it("o rodapé do gerador usa o seletor compartilhado", () => {
    render(<MobileActionBar canGenerate busy={false} downloading={false} downloadDisabled={false} onGenerate={() => {}} onDownload={() => {}} />);
    const bar = screen.getByRole("group", { name: "Ações do documento" });
    expect(bar.className).toContain(HIDE_ON_TEXT_FOCUS);
    expect(bar.className).toContain("lg:hidden");
  });
});
