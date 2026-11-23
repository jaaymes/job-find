import "client-only";

const MAX_LENGTH = 120;
const EXT = ".pdf";

/** Sem acento, sem caracteres inválidos em nome de arquivo, espaços viram `-`. */
function slug(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
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
  const cut = base.slice(0, MAX_LENGTH - EXT.length).replace(/-+$/g, "");
  return `${cut}${EXT}`;
}
