/**
 * BR Code do Pix estático (Manual do BR Code do Banco Central): texto TLV que vira o QR
 * e o "Pix copia e cola". Sem valor fixo, para quem paga escolher quanto.
 */

export type PixInput = {
  /** Chave Pix do recebedor. */
  key: string;
  /** Nome do recebedor (até 25 caracteres no BR Code). */
  name: string;
  /** Cidade do recebedor (até 15 caracteres no BR Code). */
  city: string;
};

/** Campo TLV: id de 2 dígitos, tamanho de 2 dígitos e o valor. */
function tlv(id: string, value: string): string {
  return `${id}${value.length.toString().padStart(2, "0")}${value}`;
}

/** Maiúsculas, sem acentos e só caracteres seguros, cortado no limite do campo. */
function normalize(text: string, max: number): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .toUpperCase()
    .trim()
    .slice(0, max);
}

/** CRC-16/CCITT-FALSE (polinômio 0x1021, início 0xFFFF), em 4 dígitos hexadecimais maiúsculos. */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export function buildPixPayload({ key, name, city }: PixInput): string {
  const body = [
    tlv("00", "01"),
    tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", key)),
    tlv("52", "0000"),
    tlv("53", "986"),
    tlv("58", "BR"),
    tlv("59", normalize(name, 25)),
    tlv("60", normalize(city, 15)),
    tlv("62", tlv("05", "***")),
    "6304",
  ].join("");
  return body + crc16(body);
}
