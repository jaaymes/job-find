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
});
