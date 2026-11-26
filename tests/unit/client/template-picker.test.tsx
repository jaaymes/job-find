import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TemplatePicker } from "@/components/generator/TemplatePicker";
import { assembleBaseCv } from "@/lib/client/cv/assemble";
import { CV_TEMPLATES, getTemplate } from "@/lib/client/pdf/templates/registry";
import { emptyProfile, type Profile } from "@/lib/shared/schemas/profile";

const mocks = vi.hoisted(() => ({ renderCvThumbnail: vi.fn() }));
vi.mock("@/lib/client/pdf/thumbnail", () => ({ renderCvThumbnail: mocks.renderCvThumbnail, peekThumbnail: () => null }));
vi.mock("@/components/generator/PdfPreview", () => ({
  PdfPreview: ({ templateId }: { templateId: string }) => <div data-testid="preview-grande" data-template={templateId} />,
}));

const profile: Profile = {
  ...emptyProfile(),
  name: "Ana Exemplo",
  headline: "Dev full stack",
  experiences: [
    {
      id: "exp_1",
      company: "Empresa Ficticia",
      title: "Dev Sênior",
      startDate: "2021-01",
      endDate: null,
      bullets: [{ id: "exp_1.b1", text: "Liderou a migração para React" }],
    },
  ],
};
const cv = assembleBaseCv(profile, "pt");

beforeEach(() => {
  mocks.renderCvThumbnail.mockReset();
  mocks.renderCvThumbnail.mockResolvedValue("blob:x");
});
afterEach(cleanup);

async function open(props: Partial<React.ComponentProps<typeof TemplatePicker>> = {}) {
  const onChange = vi.fn();
  render(<TemplatePicker value="classico" recommended="moderno" onChange={onChange} cv={cv} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Modelo do CV: Clássico" }));
  return { onChange, dialog: await screen.findByRole("dialog") };
}

describe("TemplatePicker", () => {
  it("com disabled, o botão do modelo fica desabilitado", () => {
    render(<TemplatePicker value="classico" recommended="moderno" onChange={() => {}} cv={cv} disabled />);
    expect((screen.getByRole("button", { name: "Modelo do CV: Clássico" }) as HTMLButtonElement).disabled).toBe(true);
  });


  it("o texto visível do botão é exatamente o nome acessível (WCAG 2.5.3), sem aria-label", () => {
    render(<TemplatePicker value="classico" recommended="moderno" onChange={() => {}} cv={cv} />);
    const trigger = screen.getByRole("button", { name: "Modelo do CV: Clássico" });
    expect(trigger.hasAttribute("aria-label")).toBe(false);
    expect(trigger.textContent?.trim()).toBe("Modelo do CV: Clássico");
  });

  it("o texto do botão quebra linha em vez de vazar do contêiner", () => {
    render(<TemplatePicker value="classico" recommended="moderno" onChange={() => {}} cv={cv} triggerClassName="w-full" />);
    const trigger = screen.getByRole("button", { name: "Modelo do CV: Clássico" });
    expect(trigger.className).toContain("max-w-full");
    expect(trigger.className).toContain("w-full");
    expect(trigger.className).toContain("whitespace-normal");
    expect(trigger.className).not.toContain("whitespace-nowrap");
    const text = trigger.querySelector("span.text-left");
    expect(text?.className).toContain("min-w-0");
    expect(text?.className).toContain("break-words");
  });

  it("com o dialog fechado só a miniatura do botão é montada: nem a galeria nem a prévia grande", async () => {
    render(<TemplatePicker value="classico" recommended="moderno" onChange={() => {}} cv={cv} />);
    await waitFor(() => expect(mocks.renderCvThumbnail).toHaveBeenCalledTimes(1));
    expect(mocks.renderCvThumbnail).toHaveBeenCalledWith(cv, "classico", 56, expect.any(AbortSignal));
    expect(mocks.renderCvThumbnail).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 150, expect.anything());
    expect(screen.queryByTestId("preview-grande")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(document.querySelectorAll("img")).toHaveLength(1);
  });

  it("triggerCv: a miniatura do botão usa o CV estável e não renderiza de novo quando só o cv muda", async () => {
    const editado = assembleBaseCv({ ...profile, headline: "Dev front-end" }, "pt");
    const { rerender } = render(<TemplatePicker value="classico" recommended="moderno" onChange={() => {}} cv={cv} triggerCv={cv} />);
    await waitFor(() => expect(mocks.renderCvThumbnail).toHaveBeenCalledTimes(1));
    rerender(<TemplatePicker value="classico" recommended="moderno" onChange={() => {}} cv={editado} triggerCv={cv} />);
    await new Promise((r) => setTimeout(r, 500));
    expect(mocks.renderCvThumbnail).toHaveBeenCalledTimes(1);
    expect(mocks.renderCvThumbnail).not.toHaveBeenCalledWith(editado, expect.anything(), 56, expect.anything());
  });

  it("triggerCv: a galeria e a prévia grande continuam usando o cv", async () => {
    const editado = assembleBaseCv({ ...profile, headline: "Dev front-end" }, "pt");
    render(<TemplatePicker value="classico" recommended="moderno" onChange={() => {}} cv={editado} triggerCv={cv} />);
    fireEvent.click(screen.getByRole("button", { name: "Modelo do CV: Clássico" }));
    await screen.findByRole("dialog");
    await waitFor(() => expect(mocks.renderCvThumbnail).toHaveBeenCalledTimes(11));
    expect(mocks.renderCvThumbnail).toHaveBeenCalledWith(cv, "classico", 56, expect.any(AbortSignal));
    for (const t of CV_TEMPLATES) expect(mocks.renderCvThumbnail).toHaveBeenCalledWith(editado, t.id, 150, expect.any(AbortSignal));
  });

  it("sem triggerCv, a miniatura do botão usa o cv", async () => {
    const editado = assembleBaseCv({ ...profile, headline: "Dev front-end" }, "pt");
    const { rerender } = render(<TemplatePicker value="classico" recommended="moderno" onChange={() => {}} cv={cv} />);
    await waitFor(() => expect(mocks.renderCvThumbnail).toHaveBeenCalledTimes(1));
    rerender(<TemplatePicker value="classico" recommended="moderno" onChange={() => {}} cv={editado} />);
    await waitFor(() => expect(mocks.renderCvThumbnail).toHaveBeenCalledWith(editado, "classico", 56, expect.any(AbortSignal)), { timeout: 2000 });
  });

  it("abre um dialog com um radiogroup de 10 modelos, com descrição e indicação", async () => {
    const { dialog } = await open();
    const group = within(dialog).getByRole("radiogroup");
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(10);
    for (const t of CV_TEMPLATES) {
      expect(within(dialog).getAllByText(t.description).length).toBeGreaterThan(0);
      expect(within(dialog).getAllByText(`Indicado para: ${t.bestFor}`).length).toBeGreaterThan(0);
    }
    expect((within(group).getByRole("radio", { name: /Clássico/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("marca só o recomendado com 'Recomendado para você'", async () => {
    const { dialog } = await open();
    expect(within(dialog).getAllByText("Recomendado para você")).toHaveLength(1);
    const moderno = within(dialog).getByRole("radio", { name: /Moderno/ });
    expect(moderno.closest("label")?.textContent).toContain("Recomendado para você");
  });

  it("trocar o radio (ou usar as setas) não chama onChange e o dialog continua aberto", async () => {
    const { onChange } = await open();
    const harvard = screen.getByRole("radio", { name: /Harvard/ });
    fireEvent.keyDown(screen.getByRole("radio", { name: /Clássico/ }), { key: "ArrowDown" });
    fireEvent.click(harvard);
    expect((harvard as HTMLInputElement).checked).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("escolher Harvard com 'Usar como padrão' marcado e confirmar chama onChange('harvard', true)", async () => {
    const { onChange, dialog } = await open();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Usar como padrão nos próximos CVs" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: /Harvard/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Usar este modelo" }));
    expect(onChange).toHaveBeenCalledWith("harvard", true);
  });

  it("escolher Harvard e confirmar sem a caixa chama onChange('harvard', false)", async () => {
    const { onChange, dialog } = await open();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Harvard/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Usar este modelo" }));
    expect(onChange).toHaveBeenCalledWith("harvard", false);
  });

  it("manter o modelo atual, marcar a caixa e confirmar chama onChange(atual, true)", async () => {
    const { onChange, dialog } = await open();
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Usar como padrão nos próximos CVs" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Usar este modelo" }));
    expect(onChange).toHaveBeenCalledWith("classico", true);
  });

  it("showDefaultOption=false esconde a caixa de padrão", async () => {
    const { dialog } = await open({ showDefaultOption: false });
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
  });

  it("o gatilho mostra a miniatura do modelo atual e mantém o nome acessível", async () => {
    render(<TemplatePicker value="classico" recommended="moderno" onChange={() => {}} cv={cv} />);
    const trigger = screen.getByRole("button", { name: "Modelo do CV: Clássico" });
    await waitFor(() => expect(trigger.querySelector("img")).toBeTruthy());
    expect(mocks.renderCvThumbnail).toHaveBeenCalledWith(cv, "classico", expect.any(Number), expect.any(AbortSignal));
  });

  it("cada um dos 10 modelos tem uma miniatura A4", async () => {
    const { dialog } = await open();
    const group = within(dialog).getByRole("radiogroup");
    await waitFor(() => expect(group.querySelectorAll("img")).toHaveLength(10));
    for (const t of CV_TEMPLATES) expect(mocks.renderCvThumbnail).toHaveBeenCalledWith(cv, t.id, 150, expect.any(AbortSignal));
  });

  it("a prévia grande acompanha o modelo selecionado", async () => {
    const { dialog } = await open();
    expect(within(dialog).getByTestId("preview-grande").getAttribute("data-template")).toBe("classico");
    fireEvent.click(within(dialog).getByRole("radio", { name: /Harvard/ }));
    const preview = within(dialog).getByTestId("preview-grande");
    expect(preview.getAttribute("data-template")).toBe("harvard");
    const area = within(dialog).getByRole("region", { name: "Prévia do modelo" });
    expect(within(area).getByText(getTemplate("harvard").description)).toBeTruthy();
    expect(area.contains(preview)).toBe(true);
  });

  it("miniatura que falha mostra Prévia indisponível e o modelo continua selecionável", async () => {
    mocks.renderCvThumbnail.mockImplementation(async (_cv: unknown, id: string) => {
      if (id === "harvard") throw new Error("falhou");
      return "blob:x";
    });
    const { dialog, onChange } = await open();
    const harvard = within(dialog).getByRole("radio", { name: /Harvard/ }) as HTMLInputElement;
    await waitFor(() => expect(harvard.closest("label")?.textContent).toContain("Prévia indisponível"));
    fireEvent.click(harvard);
    expect(harvard.checked).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Usar este modelo" }));
    expect(onChange).toHaveBeenCalledWith("harvard", false);
  });

  describe("no celular (abaixo de sm)", () => {
    afterEach(() => {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      delete (window as { matchMedia?: unknown }).matchMedia;
    });

    const mockViewport = (wide: boolean) => {
      window.matchMedia = ((query: string) => ({
        matches: query.includes("min-width") ? wide : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })) as unknown as typeof window.matchMedia;
    };

    it("selecionar um modelo leva a prévia grande para a tela", async () => {
      mockViewport(false);
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      const { dialog } = await open();
      expect(scroll).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole("radio", { name: /Harvard/ }));
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(within(dialog).getByRole("region", { name: "Prévia do modelo" }));
    });

    it("no desktop a prévia já está ao lado: não rola", async () => {
      mockViewport(true);
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      const { dialog } = await open();
      fireEvent.click(within(dialog).getByRole("radio", { name: /Harvard/ }));
      expect(scroll).not.toHaveBeenCalled();
    });
  });
});
