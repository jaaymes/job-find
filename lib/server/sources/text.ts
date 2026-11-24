import "server-only";

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " " };

/** Decodifica entidades HTML/XML numa única passada (evita decodificar duas vezes). */
export function decodeEntities(input: string): string {
  return input.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec?: string, hex?: string, name?: string) => {
    if (name) return ENTITIES[name.toLowerCase()] ?? match;
    const code = dec ? Number.parseInt(dec, 10) : Number.parseInt(hex ?? "", 16);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** Assinatura de UTF-8 lido como latin1: um byte inicial (Â..ô) seguido de um byte de continuação (\x80..¿). */
const MOJIBAKE = /[Â-ô][\u0080-¿]/;

/**
 * Repara texto UTF-8 que foi decodificado como latin1 ("Itâ\u0080\u0099s" vira "It’s"). Só age quando o texto casa a
 * assinatura e cabe inteiro em latin1; descarta o resultado se ele gerar U+FFFD. Texto correto ("São Paulo") passa intacto.
 */
export function fixMojibake(input: string): string {
  if (!MOJIBAKE.test(input)) return input;
  for (let i = 0; i < input.length; i++) if (input.charCodeAt(i) > 0xff) return input;
  const fixed = Buffer.from(input, "latin1").toString("utf8");
  return fixed.includes("�") ? input : fixed;
}
