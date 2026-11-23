import "client-only";

import { Font } from "@react-pdf/renderer";

const FILES = { regular: "Inter-Regular.ttf", bold: "Inter-Bold.ttf" } as const;

export const PDF_FONT = "Inter";

let registered = false;

/**
 * Registra a Inter (TTF embutido no PDF, texto selecionável) e desliga a hifenização: palavra partida atrapalha o ATS.
 * No navegador as fontes vêm de `/fonts/...`; no teste em node, passe `baseDir` (caminho do sistema de arquivos).
 */
export function registerPdfFonts(baseDir?: string): void {
  if (registered) return;
  const base = baseDir ?? "/fonts";
  Font.register({
    family: PDF_FONT,
    fonts: [
      { src: `${base}/${FILES.regular}`, fontWeight: 400 },
      { src: `${base}/${FILES.bold}`, fontWeight: 700 },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
