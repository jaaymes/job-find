import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssembledCv } from "@/lib/client/cv/assemble";
import type { CvTemplateId } from "@/lib/client/pdf/templates/types";

const renderCvPdf = vi.fn();

vi.mock("@/lib/client/pdf/render", () => ({ renderCvPdf: (...a: unknown[]) => renderCvPdf(...a) }));
vi.mock("unpdf/pdfjs", () => ({
  getDocument: () => ({
    promise: Promise.resolve({ getPage: async () => ({}) }),
    destroy: async () => undefined,
  }),
}));
vi.mock("@/lib/client/pdf/draw-page", () => ({
  drawPdfPage: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
}));

import { __resetThumbnailCache, peekThumbnail, renderCvThumbnail, thumbnailKey } from "@/lib/client/pdf/thumbnail";

const cv = { name: "Ana" } as unknown as AssembledCv;
const modelos = ["classic", "modern", "compact", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s"] as unknown as CvTemplateId[];

let urls = 0;
const revoke = vi.fn();

beforeEach(() => {
  __resetThumbnailCache();
  renderCvPdf.mockReset();
  renderCvPdf.mockResolvedValue({ blob: new Blob(["%PDF"]), pages: 1 });
  revoke.mockReset();
  urls = 0;
  URL.createObjectURL = vi.fn(() => `blob:t${++urls}`);
  URL.revokeObjectURL = revoke;
  HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
    cb(new Blob(["png"], { type: "image/png" }));
  } as HTMLCanvasElement["toBlob"];
});

describe("miniatura do CV", () => {
  it("mesma chave reaproveita o cache e não renderiza de novo", async () => {
    const a = await renderCvThumbnail(cv, modelos[0], 200);
    const b = await renderCvThumbnail(cv, modelos[0], 200);
    expect(renderCvPdf).toHaveBeenCalledTimes(1);
    expect(b).toBe(a);
  });

  it("CV diferente gera chave diferente", () => {
    expect(thumbnailKey(cv, modelos[0], 200)).not.toBe(thumbnailKey({ name: "Bia" } as unknown as AssembledCv, modelos[0], 200));
  });

  it("renderiza uma por vez", async () => {
    let atual = 0;
    let maximo = 0;
    renderCvPdf.mockImplementation(async () => {
      atual++;
      maximo = Math.max(maximo, atual);
      await new Promise((r) => setTimeout(r, 5));
      atual--;
      return { blob: new Blob(["%PDF"]), pages: 1 };
    });
    await Promise.all([0, 1, 2].map((i) => renderCvThumbnail(cv, modelos[i], 200)));
    expect(renderCvPdf).toHaveBeenCalledTimes(3);
    expect(maximo).toBe(1);
  });

  it("o cache guarda no máximo 20 e revoga o URL do mais antigo", async () => {
    const primeiro = await renderCvThumbnail(cv, modelos[0], 200);
    for (let i = 1; i < 21; i++) await renderCvThumbnail(cv, modelos[i], 200);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(primeiro);
  });

  it("acerto no cache renova a recência: o despejo é do menos usado (LRU)", async () => {
    const primeiro = await renderCvThumbnail(cv, modelos[0], 200);
    const segundo = await renderCvThumbnail(cv, modelos[1], 200);
    for (let i = 2; i < 20; i++) await renderCvThumbnail(cv, modelos[i], 200);
    await renderCvThumbnail(cv, modelos[0], 200);
    await renderCvThumbnail(cv, modelos[20], 200);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(segundo);
    expect(revoke).not.toHaveBeenCalledWith(primeiro);
  });

  it("peekThumbnail devolve o URL em cache sem renderizar, e null quando não há", async () => {
    expect(peekThumbnail(cv, modelos[0], 200)).toBeNull();
    const url = await renderCvThumbnail(cv, modelos[0], 200);
    expect(peekThumbnail(cv, modelos[0], 200)).toBe(url);
    expect(peekThumbnail(cv, modelos[1], 200)).toBeNull();
    expect(renderCvPdf).toHaveBeenCalledTimes(1);
  });

  it("falha na renderização rejeita e não fica no cache", async () => {
    renderCvPdf.mockRejectedValueOnce(new Error("falhou"));
    await expect(renderCvThumbnail(cv, modelos[0], 200)).rejects.toThrow("falhou");
    await expect(renderCvThumbnail(cv, modelos[0], 200)).resolves.toMatch(/^blob:/);
    expect(renderCvPdf).toHaveBeenCalledTimes(2);
  });
  it("pedido na fila abortado antes da vez não renderiza, rejeita com AbortError e não vai para o cache", async () => {
    let solta: () => void = () => undefined;
    renderCvPdf.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (solta = r));
      return { blob: new Blob(["%PDF"]), pages: 1 };
    });
    const primeiro = renderCvThumbnail(cv, modelos[0], 200);
    const ctrl = new AbortController();
    const segundo = renderCvThumbnail(cv, modelos[1], 200, ctrl.signal);
    const terceiro = renderCvThumbnail(cv, modelos[2], 200);
    await vi.waitFor(() => expect(renderCvPdf).toHaveBeenCalledTimes(1));
    ctrl.abort();
    solta();
    await expect(primeiro).resolves.toMatch(/^blob:/);
    await expect(segundo).rejects.toMatchObject({ name: "AbortError" });
    await expect(terceiro).resolves.toMatch(/^blob:/);
    // Só o 1º e o 3º renderizaram: o abortado saiu da fila sem custo.
    expect(renderCvPdf).toHaveBeenCalledTimes(2);
    expect(peekThumbnail(cv, modelos[1], 200)).toBeNull();
  });

  it("dois pedidos da mesma miniatura: abortar um não quebra o outro", async () => {
    let solta: () => void = () => undefined;
    renderCvPdf.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (solta = r));
      return { blob: new Blob(["%PDF"]), pages: 1 };
    });
    const ocupa = renderCvThumbnail(cv, modelos[0], 200);
    const ctrl = new AbortController();
    const abortado = renderCvThumbnail(cv, modelos[1], 200, ctrl.signal);
    const outro = renderCvThumbnail(cv, modelos[1], 200, new AbortController().signal);
    await vi.waitFor(() => expect(renderCvPdf).toHaveBeenCalledTimes(1));
    ctrl.abort();
    solta();
    await ocupa;
    await expect(abortado).rejects.toMatchObject({ name: "AbortError" });
    const url = await outro;
    expect(url).toMatch(/^blob:/);
    expect(peekThumbnail(cv, modelos[1], 200)).toBe(url);
    expect(renderCvPdf).toHaveBeenCalledTimes(2);
  });

  it("abortar depois de a renderização começar não a interrompe: termina e fica no cache", async () => {
    let solta: () => void = () => undefined;
    renderCvPdf.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (solta = r));
      return { blob: new Blob(["%PDF"]), pages: 1 };
    });
    const ctrl = new AbortController();
    const pedido = renderCvThumbnail(cv, modelos[0], 200, ctrl.signal);
    await vi.waitFor(() => expect(renderCvPdf).toHaveBeenCalledTimes(1));
    ctrl.abort();
    solta();
    const url = await pedido;
    expect(peekThumbnail(cv, modelos[0], 200)).toBe(url);
  });

  it("libera o canvas temporário depois de gerar o PNG", async () => {
    const canvases: HTMLCanvasElement[] = [];
    const create = document.createElement.bind(document);
    const spy = vi.spyOn(document, "createElement").mockImplementation((tag: string, opts?: ElementCreationOptions) => {
      const el = create(tag, opts);
      if (tag === "canvas") {
        (el as HTMLCanvasElement).width = 300;
        (el as HTMLCanvasElement).height = 400;
        canvases.push(el as HTMLCanvasElement);
      }
      return el;
    });
    try {
      await renderCvThumbnail(cv, modelos[0], 200);
    } finally {
      spy.mockRestore();
    }
    expect(canvases).toHaveLength(1);
    expect(canvases[0].width).toBe(0);
    expect(canvases[0].height).toBe(0);
  });
});
