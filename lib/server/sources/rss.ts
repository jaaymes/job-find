import "server-only";
import { decodeEntities } from "@/lib/server/sources/text";

/** Campos de `<item>` lidos. */
export const RSS_FIELDS = ["title", "region", "category", "description", "pubDate", "guid", "link"] as const;

// RSS sem dependência de XML: o feed é plano, um nível de campos por <item>.

const CDATA = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/;

/** Valor de texto de um campo: CDATA vale como está; fora dele, as entidades XML são decodificadas. */
function fieldValue(inner: string): string {
  const cdata = CDATA.exec(inner);
  return (cdata ? cdata[1]! : decodeEntities(inner)).trim();
}

/** Extrai os campos conhecidos de cada `<item>` do RSS; sem itens (ou HTML no lugar do feed), devolve `[]`. */
export function parseRssItems(xml: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];
  for (const block of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item: Record<string, string> = {};
    for (const field of RSS_FIELDS) {
      const m = new RegExp(`<${field}>([\\s\\S]*?)</${field}>`).exec(block[1]!);
      if (m) item[field] = fieldValue(m[1]!);
    }
    items.push(item);
  }
  return items;
}
