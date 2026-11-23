import "client-only";

const MAX_LENGTH = 120;
const EXT = ".pdf";

/** Sem acento, sem caracteres inválidos em nome de arquivo, espaços viram `-`. */
function slug(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      // Invisíveis/bidi (\p{Cf}: U+200B, U+202E...) não podem disfarçar a extensão nem o nome.
      .replace(/\p{Cf}/gu, "")
      .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

/** `CV-<Nome>-<Empresa>-<cargo>.pdf`. Segmento vazio é omitido; tudo vazio dá `CV.pdf`. Até 120 caracteres. */
export function cvFileName(name: string, company: string, role: string): string {
  const base = ["CV", slug(name), slug(company), slug(role)].filter(Boolean).join("-");
  // Corta por ponto de código (sem partir um par substituto, ex.: emoji) dentro do limite em unidades UTF-16.
  let cut = "";
  for (const ch of base) {
    if (cut.length + ch.length > MAX_LENGTH - EXT.length) break;
    cut += ch;
  }
  // Sem hífen nem ponto no fim: evita `..pdf` ("Dev Sr.").
  cut = cut.replace(/[-.\s]+$/u, "");
  return `${cut || "CV"}${EXT}`;
}
