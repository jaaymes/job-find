import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemplatePicker } from "@/components/generator/TemplatePicker";
import { CV_TEMPLATES } from "@/lib/client/pdf/templates/registry";

afterEach(cleanup);

async function open(props: Partial<React.ComponentProps<typeof TemplatePicker>> = {}) {
  const onChange = vi.fn();
  render(<TemplatePicker value="classico" recommended="moderno" onChange={onChange} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Modelo do CV: Clássico" }));
  return { onChange, dialog: await screen.findByRole("dialog") };
}

describe("TemplatePicker", () => {
  it("o botão tem o nome acessível com o modelo atual", () => {
    render(<TemplatePicker value="classico" recommended="moderno" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Modelo do CV: Clássico" })).toBeTruthy();
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
});
