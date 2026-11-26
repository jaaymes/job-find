import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CvThumbnail } from "@/components/generator/CvThumbnail";
import type { AssembledCv } from "@/lib/client/cv/assemble";

const mocks = vi.hoisted(() => ({ renderCvThumbnail: vi.fn(), peekThumbnail: vi.fn() }));
vi.mock("@/lib/client/pdf/thumbnail", () => ({
  renderCvThumbnail: mocks.renderCvThumbnail,
  peekThumbnail: mocks.peekThumbnail,
}));

const cvPt = { name: "Ana", lang: "pt" } as unknown as AssembledCv;
const cvEn = { name: "Ana", lang: "en" } as unknown as AssembledCv;
const urlOf = (cv: AssembledCv) => `blob:${(cv as unknown as { lang: string }).lang}`;

const img = (container: HTMLElement) => container.querySelector("img");

beforeEach(() => {
  mocks.renderCvThumbnail.mockReset();
  mocks.peekThumbnail.mockReset();
  mocks.peekThumbnail.mockReturnValue(null);
  mocks.renderCvThumbnail.mockImplementation(async (cv: AssembledCv) => urlOf(cv));
});
afterEach(cleanup);

describe("CvThumbnail", () => {
  it("trocar o cv não mostra a imagem antiga: skeleton até a nova ficar pronta", async () => {
    const { container, rerender } = render(<CvThumbnail cv={cvPt} templateId="classico" width={150} />);
    await waitFor(() => expect(img(container)?.getAttribute("src")).toBe("blob:pt"));
    rerender(<CvThumbnail cv={cvEn} templateId="classico" width={150} />);
    expect(img(container)).toBeNull();
    expect(screen.getByRole("status", { hidden: true })).toBeTruthy();
    await waitFor(() => expect(img(container)?.getAttribute("src")).toBe("blob:en"), { timeout: 2000 });
  });

  it("cv já em cache aparece na hora, sem renderizar de novo", async () => {
    const { container, rerender } = render(<CvThumbnail cv={cvPt} templateId="classico" width={150} />);
    await waitFor(() => expect(img(container)).toBeTruthy());
    mocks.peekThumbnail.mockImplementation((cv: AssembledCv) => (cv === cvEn ? "blob:en-cache" : null));
    mocks.renderCvThumbnail.mockClear();
    rerender(<CvThumbnail cv={cvEn} templateId="classico" width={150} />);
    expect(img(container)?.getAttribute("src")).toBe("blob:en-cache");
    await act(async () => new Promise((r) => setTimeout(r, 450)));
    expect(mocks.renderCvThumbnail).not.toHaveBeenCalled();
  });

  it("imagem com URL revogado tenta renderizar uma vez de novo e depois mostra Prévia indisponível", async () => {
    mocks.renderCvThumbnail.mockResolvedValueOnce("blob:velho").mockResolvedValueOnce("blob:novo");
    const { container } = render(<CvThumbnail cv={cvPt} templateId="classico" width={150} />);
    await waitFor(() => expect(img(container)?.getAttribute("src")).toBe("blob:velho"));
    fireEvent.error(img(container)!);
    await waitFor(() => expect(img(container)?.getAttribute("src")).toBe("blob:novo"));
    expect(mocks.renderCvThumbnail).toHaveBeenCalledTimes(2);
    fireEvent.error(img(container)!);
    await waitFor(() => expect(container.textContent).toContain("Prévia indisponível"));
    expect(mocks.renderCvThumbnail).toHaveBeenCalledTimes(2);
  });
  it("passa um AbortSignal e o aborta ao desmontar", async () => {
    let sinal: AbortSignal | undefined;
    mocks.renderCvThumbnail.mockImplementation((_cv: AssembledCv, _id: string, _w: number, s?: AbortSignal) => {
      sinal = s;
      return new Promise<string>(() => undefined);
    });
    const { unmount } = render(<CvThumbnail cv={cvPt} templateId="classico" width={150} />);
    await waitFor(() => expect(sinal).toBeInstanceOf(AbortSignal));
    expect(sinal!.aborted).toBe(false);
    unmount();
    expect(sinal!.aborted).toBe(true);
  });

  it("trocar o cv aborta o pedido anterior", async () => {
    const sinais: AbortSignal[] = [];
    mocks.renderCvThumbnail.mockImplementation((_cv: AssembledCv, _id: string, _w: number, s: AbortSignal) => {
      sinais.push(s);
      return new Promise<string>(() => undefined);
    });
    const { rerender } = render(<CvThumbnail cv={cvPt} templateId="classico" width={150} />);
    await waitFor(() => expect(sinais).toHaveLength(1));
    rerender(<CvThumbnail cv={cvEn} templateId="classico" width={150} />);
    expect(sinais[0].aborted).toBe(true);
  });

  it("AbortError não mostra Prévia indisponível", async () => {
    let rejeita: (e: unknown) => void = () => undefined;
    mocks.renderCvThumbnail.mockImplementation(() => new Promise<string>((_r, rej) => (rejeita = rej)));
    const { container } = render(<CvThumbnail cv={cvPt} templateId="classico" width={150} />);
    await waitFor(() => expect(mocks.renderCvThumbnail).toHaveBeenCalled());
    await act(async () => rejeita(new DOMException("cancelada", "AbortError")));
    expect(container.textContent).not.toContain("Prévia indisponível");
    expect(screen.getByRole("status", { hidden: true })).toBeTruthy();
  });
});
