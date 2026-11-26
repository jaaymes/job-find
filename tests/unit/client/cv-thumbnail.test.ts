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

import { __resetThumbnailCache, renderCvThumbnail, thumbnailKey } from "@/lib/client/pdf/thumbnail";

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

  it("falha na renderização rejeita e não fica no cache", async () => {
    renderCvPdf.mockRejectedValueOnce(new Error("falhou"));
    await expect(renderCvThumbnail(cv, modelos[0], 200)).rejects.toThrow("falhou");
    await expect(renderCvThumbnail(cv, modelos[0], 200)).resolves.toMatch(/^blob:/);
    expect(renderCvPdf).toHaveBeenCalledTimes(2);
  });
});
