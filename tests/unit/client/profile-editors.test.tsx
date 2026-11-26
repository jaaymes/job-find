import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BaseCvDownload } from "@/components/profile/BaseCvDownload";
import { CertificationsEditor } from "@/components/profile/CertificationsEditor";
import { ExperienceEditor } from "@/components/profile/ExperienceEditor";
import { LanguagesEditor } from "@/components/profile/LanguagesEditor";
import { ProfileEditor } from "@/components/profile/ProfileEditor";
import { ProjectsEditor } from "@/components/profile/ProjectsEditor";
import { emptyProfile, type Profile } from "@/lib/shared/schemas/profile";

const mocks = vi.hoisted(() => ({ renderCvPdf: vi.fn() }));
vi.mock("@/lib/client/pdf/render", () => ({ renderCvPdf: mocks.renderCvPdf }));
// Miniaturas e prévia do seletor de modelo não entram na contagem de renderCvPdf do download.
vi.mock("@/lib/client/pdf/thumbnail", () => ({ renderCvThumbnail: async () => "blob:x", peekThumbnail: () => null }));
vi.mock("@/components/generator/PdfPreview", () => ({ PdfPreview: () => null }));

afterEach(cleanup);

function Projects({ initial = [] as Profile["projects"], spy = vi.fn() }) {
  const [v, setV] = useState(initial);
  return <ProjectsEditor projects={v} onChange={(x) => (spy(x), setV(x))} />;
}

describe("ProjectsEditor", () => {
  it("cria proj_1, depois proj_2, e mostra a ajuda de idioma", () => {
    const spy = vi.fn();
    render(<Projects spy={spy} />);
    expect(screen.getByText(/Escreva os projetos no idioma em que vai se candidatar/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar projeto" }));
    fireEvent.click(screen.getByRole("button", { name: "Adicionar projeto" }));
    const last = spy.mock.calls.at(-1)![0] as Profile["projects"];
    expect(last.map((p) => p.id)).toEqual(["proj_1", "proj_2"]);
  });

  it("'+ Realização' cria proj_1.b1", () => {
    const spy = vi.fn();
    render(<Projects spy={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar projeto" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Realização" }));
    const last = spy.mock.calls.at(-1)![0] as Profile["projects"];
    expect(last[0].bullets).toEqual([{ id: "proj_1.b1", text: "" }]);
  });

  it("tecnologias viram lista e link vazio vira null", () => {
    const spy = vi.fn();
    render(<Projects spy={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar projeto" }));
    fireEvent.change(screen.getByLabelText(/^Tecnologias/), { target: { value: "React, Node" } });
    fireEvent.change(screen.getByLabelText(/^Link/), { target: { value: " " } });
    const last = (spy.mock.calls.at(-1)![0] as Profile["projects"])[0];
    expect(last.stacks).toEqual(["React", "Node"]);
    expect(last.link).toBeNull();
  });
});

describe("ProjectsEditor com stacks vindas de fora", () => {
  it("mostra o texto novo no campo Tecnologias depois de um desfazer", () => {
    const proj = (stacks: string[]): Profile["projects"] => [{ id: "proj_1", name: "P", link: null, stacks, bullets: [] }];
    const { rerender } = render(<ProjectsEditor projects={proj(["React"])} onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Editar projeto/ }));
    expect((screen.getByLabelText(/^Tecnologias/) as HTMLInputElement).value).toBe("React");
    rerender(<ProjectsEditor projects={proj(["Vue", "Go"])} onChange={() => {}} />);
    expect((screen.getByLabelText(/^Tecnologias/) as HTMLInputElement).value).toBe("Vue, Go");
  });
});

describe("LanguagesEditor", () => {
  it("o select de nível tem as 5 opções em português", () => {
    render(<LanguagesEditor languages={[{ name: "Inglês", level: "fluent" }]} onChange={() => {}} />);
    const opts = [...screen.getByLabelText("Nível do idioma 1").querySelectorAll("option")].map((o) => o.textContent);
    expect(opts).toEqual(["Básico", "Intermediário", "Avançado", "Fluente", "Nativo"]);
  });
});

describe("CertificationsEditor", () => {
  it("emissor e ano vazios gravam null", () => {
    const onChange = vi.fn();
    render(<CertificationsEditor certifications={[{ name: "AWS SAA", issuer: "AWS", year: "2024" }]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Emissor da certificação 1"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith([{ name: "AWS SAA", issuer: null, year: "2024" }]);
    fireEvent.change(screen.getByLabelText("Ano da certificação 1"), { target: { value: " " } });
    expect(onChange).toHaveBeenLastCalledWith([{ name: "AWS SAA", issuer: "AWS", year: null }]);
  });
});

const experiences = (): Profile["experiences"] => [
  {
    id: "exp_1",
    company: "Acme",
    title: "Dev",
    startDate: null,
    endDate: null,
    bullets: [1, 2, 3, 4].map((n) => ({ id: `exp_1.b${n}`, text: `Bullet ${n}` })),
  },
];

function Exp({ initial = [] as string[] }) {
  const [hl, setHl] = useState(initial);
  const [exps, setExps] = useState(experiences());
  return (
    <>
      <ExperienceEditor profile={emptyProfile()} experiences={exps} onChange={setExps} highlights={hl} onHighlightsChange={setHl} />
      <output data-testid="hl">{hl.join(",")}</output>
    </>
  );
}

describe("estrela de destaque", () => {
  const open = () => fireEvent.click(screen.getByRole("button", { name: /^Editar experiência/ }));
  const stars = () => screen.getAllByRole("button", { name: "Destacar no CV" });

  it("alterna o id em highlights com aria-pressed", () => {
    render(<Exp />);
    open();
    expect(stars()[0].getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(stars()[0]);
    expect(stars()[0].getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("hl").textContent).toBe("exp_1.b1");
    fireEvent.click(stars()[0]);
    expect(screen.getByTestId("hl").textContent).toBe("");
  });

  it("com 3 destaques, as outras estrelas ficam desabilitadas e aparece o aviso", () => {
    render(<Exp initial={["exp_1.b1", "exp_1.b2", "exp_1.b3"]} />);
    open();
    const s = stars();
    expect(s.map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, false, false, true]);
    expect(screen.getByText("Máximo de 3 destaques")).toBeTruthy();
  });

  it("ids órfãos em highlights não travam as estrelas", () => {
    render(<Exp initial={["exp_9.b1", "exp_9.b2", "exp_9.b3"]} />);
    open();
    expect(stars().map((b) => (b as HTMLButtonElement).disabled)).toEqual([false, false, false, false]);
    expect(screen.queryByText("Máximo de 3 destaques")).toBeNull();
  });

  it("apagar o último bullet e adicionar outro não reaproveita o id", () => {
    const spy = vi.fn();
    function Wrapper() {
      const [exps, setExps] = useState(experiences());
      return (
        <ExperienceEditor
          profile={emptyProfile()}
          experiences={exps}
          onChange={(x) => (spy(x), setExps(x))}
          highlights={[]}
          onHighlightsChange={() => {}}
        />
      );
    }
    render(<Wrapper />);
    open();
    const ids = () => (spy.mock.calls.at(-1)![0] as Profile["experiences"])[0].bullets.map((b) => b.id);
    fireEvent.click(screen.getByRole("button", { name: "Remover realização 4" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Realização" }));
    expect(ids()).toEqual(["exp_1.b1", "exp_1.b2", "exp_1.b3", "exp_1.b5"]);
    fireEvent.click(screen.getByRole("button", { name: "Remover realização 4" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Realização" }));
    expect(ids()).toEqual(["exp_1.b1", "exp_1.b2", "exp_1.b3", "exp_1.b6"]);
  });

  it("remover a experiência com bullet destacado esvazia highlights", () => {
    render(<Exp initial={["exp_1.b2"]} />);
    expect(screen.getByTestId("hl").textContent).toBe("exp_1.b2");
    fireEvent.click(screen.getByRole("button", { name: /^Remover experiência/ }));
    expect(screen.getByTestId("hl").textContent).toBe("");
  });

  it("recolhida, só o bullet destacado tem '(destacado)' e a estrela aria-hidden", () => {
    render(<Exp initial={["exp_1.b2"]} />);
    const items = screen.getAllByRole("listitem").filter((li) => li.parentElement?.className.includes("list-disc"));
    expect(items).toHaveLength(4);
    items.forEach((li, i) => {
      const mark = li.querySelector(".sr-only");
      if (i === 1) {
        expect(mark?.textContent).toBe("(destacado)");
        expect(li.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      } else {
        expect(mark).toBeNull();
        expect(li.querySelector("svg")).toBeNull();
      }
    });
  });

  it("apagar um bullet destacado remove o id de highlights", () => {
    render(<Exp initial={["exp_1.b2"]} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Remover realização 2" }));
    expect(screen.getByTestId("hl").textContent).toBe("");
  });
});

describe("BaseCvDownload", () => {
  beforeEach(() => {
    mocks.renderCvPdf.mockReset();
    mocks.renderCvPdf.mockResolvedValue({ blob: new Blob(["x"]), pages: 1 });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
  });

  it("'Baixar CV base' chama renderCvPdf com o template escolhido", async () => {
    const profile = { ...emptyProfile(), name: "Ana", experiences: experiences() };
    render(<BaseCvDownload profile={profile} />);
    fireEvent.click(screen.getByRole("button", { name: /^Modelo do CV:/ }));
    fireEvent.click(await screen.findByRole("radio", { name: /Harvard/ }));
    fireEvent.click(screen.getByRole("button", { name: "Usar este modelo" }));
    fireEvent.click(screen.getByRole("button", { name: "Baixar CV base" }));
    await waitFor(() => expect(mocks.renderCvPdf).toHaveBeenCalledTimes(1));
    const [cv, templateId] = mocks.renderCvPdf.mock.calls[0];
    expect(templateId).toBe("harvard");
    expect(cv.name).toBe("Ana");
  });

  it("é a seção 'Modelos de CV' e a escolha vira o modelo padrão dos próximos CVs", async () => {
    window.localStorage.clear();
    const profile = { ...emptyProfile(), name: "Ana", experiences: experiences() };
    render(<BaseCvDownload profile={profile} />);
    expect(screen.getByRole("heading", { level: 2, name: "Modelos de CV" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Modelo do CV:/ }));
    fireEvent.click(await screen.findByRole("radio", { name: /Minimalista/ }));
    fireEvent.click(screen.getByRole("button", { name: "Usar este modelo" }));
    expect(JSON.parse(window.localStorage.getItem("jobfind:v1:cvPrefs") ?? "{}").data).toEqual({
      templateId: "minimalista",
    });
    window.localStorage.clear();
  });
});

describe("assistente visível no perfil", () => {
  const withExp = (): Profile => ({
    ...emptyProfile(),
    experiences: [
      { id: "exp_1", company: "Acme", title: "Dev", startDate: null, endDate: null, bullets: [{ id: "exp_1.b1", text: "Fiz A" }] },
    ],
  });

  it("experiência fechada já mostra Melhorar com IA", () => {
    render(<ExperienceEditor profile={withExp()} experiences={withExp().experiences} onChange={() => {}} highlights={[]} onHighlightsChange={() => {}} />);
    expect(screen.getByRole("button", { name: /^Melhorar com IA/ })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Realizações" })).toBeNull();
  });

  it("o botão de IA dentro da experiência aberta tem o título da experiência no nome acessível", () => {
    render(<ExperienceEditor profile={withExp()} experiences={withExp().experiences} onChange={() => {}} highlights={[]} onHighlightsChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^Editar experiência/ }));
    const grupo = screen.getByRole("group", { name: "Realizações" });
    expect(within(grupo).getByRole("button", { name: "Melhorar com IA: Dev · Acme" })).toBeTruthy();
  });

  it("experiência mais recente sem realizações: o atalho do hub diz Escrever", () => {
    const vazia: Profile = { ...withExp(), experiences: [{ ...withExp().experiences[0], bullets: [] }] };
    render(<ProfileEditor profile={vazia} onSave={() => true} />);
    expect(screen.getByRole("button", { name: "Escrever a experiência mais recente com IA" })).toBeTruthy();
  });

  it("o atalho de experiências abre a experiência fechada e o assistente dela", async () => {
    render(<ProfileEditor profile={withExp()} onSave={() => true} />);
    fireEvent.click(screen.getByRole("button", { name: "Melhorar a experiência mais recente com IA" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });
});
