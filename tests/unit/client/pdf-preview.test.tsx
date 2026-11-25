import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfPreview } from "@/components/generator/PdfPreview";
import type { AssembledCv } from "@/lib/client/cv/assemble";

const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  render: vi.fn(),
}));

vi.mock("unpdf/pdfjs", () => ({ getDocument: pdfjs.getDocument }));
vi.mock("@/lib/client/pdf/render", () => ({
  renderCvPdf: async () => ({ blob: new Blob(["%PDF-1.4"], { type: "application/pdf" }), pages: 2 }),
  renderLetterPdf: async () => ({ blob: new Blob(["%PDF-1.4"], { type: "application/pdf" }), pages: 1 }),
}));

const cv = { name: "Ana Souza", experiences: [], skills: [], education: [], certifications: [] } as unknown as AssembledCv;

function fakeDocument() {
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render: () => {
      pdfjs.render();
      return { promise: Promise.resolve(), cancel: () => {} };
    },
  };
  return { numPages: 2, getPage: async () => page, destroy: async () => {} };
}

beforeEach(() => {
  pdfjs.getDocument.mockReset();
  pdfjs.render.mockReset();
  pdfjs.getDocument.mockImplementation(() => ({ promise: Promise.resolve(fakeDocument()), destroy: async () => {} }));
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:http://localhost/pdf-1", revokeObjectURL: () => {} }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PdfPreview em modo canvas", () => {
  it("modo canvas renderiza 2 canvas com rótulos Página 1 e Página 2 do PDF", async () => {
    render(<PdfPreview cv={cv} letter={null} mode="canvas" />);
    expect(await screen.findByLabelText("Página 1 do PDF", {}, { timeout: 3000 })).toBeInstanceOf(HTMLCanvasElement);
    expect(screen.getByLabelText("Página 2 do PDF")).toBeInstanceOf(HTMLCanvasElement);
    await waitFor(() => expect(pdfjs.render).toHaveBeenCalledTimes(2));
  });

  it("modo canvas oferece Abrir PDF em tela cheia", async () => {
    render(<PdfPreview cv={cv} letter={null} mode="canvas" />);
    const link = await screen.findByRole("link", { name: /Abrir PDF em tela cheia/ }, { timeout: 3000 });
    expect(link.getAttribute("href")).toBe("blob:http://localhost/pdf-1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("falha do pdfjs cai para o link de abrir o PDF com aviso", async () => {
    pdfjs.getDocument.mockImplementation(() => ({ promise: Promise.reject(new Error("boom")), destroy: async () => {} }));
    render(<PdfPreview cv={cv} letter={null} mode="canvas" />);
    expect(await screen.findByRole("alert", {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByLabelText("Página 1 do PDF")).toBeNull();
    expect(screen.getByRole("link", { name: /Abrir PDF em tela cheia/ }).getAttribute("href")).toBe("blob:http://localhost/pdf-1");
  });

  it("modo iframe mantém o iframe", async () => {
    render(<PdfPreview cv={cv} letter={null} mode="iframe" />);
    const frame = await screen.findByTitle("Pré-visualização do PDF", {}, { timeout: 3000 });
    expect(frame.tagName).toBe("IFRAME");
  });
});
