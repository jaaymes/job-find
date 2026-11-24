import "client-only";

import { pdf } from "@react-pdf/renderer";
import type { AssembledCv } from "@/lib/client/cv/assemble";
import type { TailoredDocs } from "@/lib/shared/schemas/tailored";
import { CoverLetterDocument } from "./CoverLetterDocument";
import { CvDocument } from "./CvDocument";
import { registerPdfFonts } from "./fonts";

export type PdfResult = { blob: Blob; pages: number };

/** Conta as páginas pelo próprio PDF (cada objeto /Type /Page; /Pages é o nó pai e não entra). */
async function toResult(instance: ReturnType<typeof pdf>): Promise<PdfResult> {
  const blob = await instance.toBlob();
  const raw = new TextDecoder("latin1").decode(await blob.arrayBuffer());
  const pages = (raw.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  return { blob, pages: Math.max(pages, 1) };
}

/** `fontsDir` só existe para o teste em node (caminho do sistema de arquivos); no navegador usa `/fonts`. */
export async function renderCvPdf(cv: AssembledCv, fontsDir?: string): Promise<PdfResult> {
  registerPdfFonts(fontsDir);
  return toResult(pdf(<CvDocument cv={cv} />));
}

export async function renderLetterPdf(
  letter: NonNullable<TailoredDocs["coverLetter"]>,
  cv: AssembledCv,
  fontsDir?: string,
): Promise<PdfResult> {
  registerPdfFonts(fontsDir);
  return toResult(pdf(<CoverLetterDocument letter={letter} cv={cv} />));
}
