import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUnsavedChangesGuard } from "@/lib/client/use-unsaved-changes-guard";

const MSG = "Você tem alterações não salvas no perfil. Sair mesmo assim?";

function Harness({ dirty }: { dirty: boolean }) {
  useUnsavedChangesGuard(dirty, MSG);
  return (
    <div>
      <a href="/minhas-vagas">interno</a>
      <a href="/x" target="_blank">nova aba</a>
      <a href={window.location.pathname}>mesmo caminho</a>
      <a href="https://exemplo.test/y">externo</a>
      <a href="/arquivo.pdf" download>baixar</a>
    </div>
  );
}

const link = (name: string) => [...document.querySelectorAll("a")].find((a) => a.textContent === name)!;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useUnsavedChangesGuard", () => {
  it("pergunta ao clicar em link interno e bloqueia se o usuário recusar", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Harness dirty />);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    link("interno").dispatchEvent(ev);
    expect(confirm).toHaveBeenCalledWith(MSG);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("ao cancelar, barra a propagação para handlers do link e do container", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const onClick = vi.fn();
    render(
      <div onClick={onClick}>
        <Harness dirty />
      </div>,
    );
    const handler = vi.fn();
    link("interno").addEventListener("click", handler);
    fireEvent.click(link("interno"));
    expect(handler).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
  });

  it("depois de aceitar o confirm, o beforeunload não bloqueia de novo", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Harness dirty />);
    fireEvent.click(link("interno"));
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("a liberação do beforeunload expira se a navegação não acontecer", () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<Harness dirty />);
      fireEvent.click(link("interno"));
      vi.advanceTimersByTime(1100);
      const ev = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deixa seguir se o usuário aceitar", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Harness dirty />);
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    link("interno").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("não pergunta em target=_blank, ctrl, meta, botão do meio, mesmo caminho, externo e download", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Harness dirty />);
    fireEvent.click(link("nova aba"));
    fireEvent.click(link("interno"), { ctrlKey: true });
    fireEvent.click(link("interno"), { metaKey: true });
    fireEvent(link("interno"), new MouseEvent("click", { bubbles: true, cancelable: true, button: 1 }));
    fireEvent.click(link("mesmo caminho"));
    fireEvent.click(link("externo"));
    fireEvent.click(link("baixar"));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("ignora cliques cujo alvo não é um elemento", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Harness dirty />);
    expect(() => document.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).not.toThrow();
    const text = document.createTextNode("x");
    document.body.appendChild(text);
    expect(() => text.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))).not.toThrow();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("sem alterações não pergunta nem bloqueia o beforeunload", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Harness dirty={false} />);
    fireEvent.click(link("interno"));
    expect(confirm).not.toHaveBeenCalled();
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("com alterações o beforeunload é bloqueado", () => {
    render(<Harness dirty />);
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("ao desmontar remove os listeners", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { unmount } = render(<Harness dirty />);
    const a = link("interno");
    document.body.appendChild(a);
    unmount();
    fireEvent.click(a);
    expect(confirm).not.toHaveBeenCalled();
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
