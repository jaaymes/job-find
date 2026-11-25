import "client-only";

import { Font } from "@react-pdf/renderer";

export type PdfFamily = "Inter" | "Source Serif 4" | "Source Sans 3" | "IBM Plex Sans";

/** Arquivos TTF (regular 400 e bold 700) e licença OFL de cada família, em `public/fonts`. */
export const PDF_FAMILIES: Record<PdfFamily, { regular: string; bold: string; license: string }> = {
  Inter: { regular: "Inter-Regular.ttf", bold: "Inter-Bold.ttf", license: "LICENSE-Inter.txt" },
  "Source Serif 4": {
    regular: "SourceSerif4-Regular.ttf",
    bold: "SourceSerif4-Bold.ttf",
    license: "LICENSE-SourceSerif4.txt",
  },
  "Source Sans 3": {
    regular: "SourceSans3-Regular.ttf",
    bold: "SourceSans3-Bold.ttf",
    license: "LICENSE-SourceSans3.txt",
  },
  "IBM Plex Sans": {
    regular: "IBMPlexSans-Regular.ttf",
    bold: "IBMPlexSans-Bold.ttf",
    license: "LICENSE-IBMPlexSans.txt",
  },
};

export const PDF_FONT: PdfFamily = "Inter";

let registered = false;

/**
 * Registra as 4 famílias (TTF embutido no PDF, texto selecionável) e desliga a hifenização: palavra partida atrapalha o ATS.
 * O @react-pdf só busca o arquivo de uma família quando um texto a usa.
 * No navegador as fontes vêm de `/fonts/...`; no teste em node, passe `baseDir` (caminho do sistema de arquivos).
 */
export function registerPdfFonts(baseDir?: string): void {
  if (registered) return;
  const base = baseDir ?? "/fonts";
  for (const [family, files] of Object.entries(PDF_FAMILIES)) {
    Font.register({
      family,
      fonts: [
        { src: `${base}/${files.regular}`, fontWeight: 400 },
        { src: `${base}/${files.bold}`, fontWeight: 700 },
      ],
    });
  }
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
