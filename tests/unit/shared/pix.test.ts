import { describe, expect, it } from "vitest";
import { buildPixPayload, crc16 } from "@/lib/shared/pix";
import { PIX } from "@/lib/shared/donation";

/** Lê o BR Code (TLV: id de 2 dígitos, tamanho de 2 dígitos, valor) em um mapa id → valor. */
function parseTlv(input: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i < input.length) {
    const id = input.slice(i, i + 2);
    const len = Number(input.slice(i + 2, i + 4));
    out.set(id, input.slice(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return out;
}

describe("crc16", () => {
  it("segue o CRC-16/CCITT-FALSE exigido pelo BR Code", () => {
    expect(crc16("123456789")).toBe("29B1");
  });
});

describe("buildPixPayload", () => {
  const payload = buildPixPayload({
    key: "23a9d09e-63da-48f0-b7e5-bbf0e68962d6",
    name: "Job Find",
    city: "Brasil",
  });
  const fields = parseTlv(payload);

  it("monta um Pix estático, em reais, para o Brasil", () => {
    expect(fields.get("00")).toBe("01");
    expect(fields.get("52")).toBe("0000");
    expect(fields.get("53")).toBe("986");
    expect(fields.get("58")).toBe("BR");
    expect(fields.has("54")).toBe(false); // sem valor fixo: quem doa escolhe
  });

  it("leva a chave no campo da conta Pix", () => {
    const account = parseTlv(fields.get("26")!);
    expect(account.get("00")).toBe("br.gov.bcb.pix");
    expect(account.get("01")).toBe("23a9d09e-63da-48f0-b7e5-bbf0e68962d6");
  });

  it("normaliza nome e cidade para maiúsculas sem acento e respeita os limites", () => {
    const p = parseTlv(buildPixPayload({ key: "k", name: "Associação dos Programadores Unidos", city: "São José dos Campos" }));
    expect(p.get("59")).toBe("ASSOCIACAO DOS PROGRAMADO");
    expect(p.get("59")!.length).toBe(25);
    expect(p.get("60")).toBe("SAO JOSE DOS CA");
    expect(p.get("60")!.length).toBe(15);
  });

  it("usa *** como txid e termina com o CRC do próprio texto", () => {
    expect(parseTlv(fields.get("62")!).get("05")).toBe("***");
    expect(payload.slice(-8, -4)).toBe("6304");
    expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
  });
});

describe("dados de doação", () => {
  it("a chave Pix publicada é a aleatória (EVP), sem CPF ou e-mail", () => {
    expect(PIX.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
