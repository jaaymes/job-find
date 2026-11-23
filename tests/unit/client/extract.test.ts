import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractContact, redactContact } from "@/lib/client/extract/contact";
import { ExtractError, extractText } from "@/lib/client/extract";

const fixture = (name: string, type = "") => {
  const bytes = readFileSync(resolve(import.meta.dirname, "../../fixtures/cv", name));
  return new File([new Uint8Array(bytes)], name, { type });
};

describe("extractText", () => {
  it("rejeita arquivo acima de 5 MB (too_large)", async () => {
    const big = new File([new Uint8Array(6 * 1024 * 1024)], "grande.pdf");
    await expect(extractText(big)).rejects.toMatchObject({ code: "too_large" });
    await expect(extractText(big)).rejects.toBeInstanceOf(ExtractError);
  });

  it("rejeita .pdf com magic bytes errados (bad_type)", async () => {
    await expect(extractText(fixture("fake.pdf"))).rejects.toMatchObject({ code: "bad_type" });
  });

  it("rejeita extensão desconhecida (bad_type)", async () => {
    const f = new File([new Uint8Array([1, 2, 3])], "cv.txt");
    await expect(extractText(f)).rejects.toMatchObject({ code: "bad_type" });
  });

  it("lê PDF com camada de texto", async () => {
    const r = await extractText(fixture("texto.pdf"));
    expect(r.kind).toBe("pdf");
    expect(r.pages).toBe(1);
    expect(r.scanned).toBe(false);
    expect(r.text).toContain("TypeScript");
  });

  it("lê PDF de duas colunas", async () => {
    const r = await extractText(fixture("colunas.pdf"));
    expect(r.scanned).toBe(false);
    expect(r.text.length).toBeGreaterThan(100);
  });

  it("marca PDF só com imagem como escaneado", async () => {
    const r = await extractText(fixture("escaneado.pdf"));
    expect(r.scanned).toBe(true);
  });

  it("lê DOCX", async () => {
    const r = await extractText(fixture("cv.docx"));
    expect(r.kind).toBe("docx");
    expect(r.text).toContain("Experiência");
    expect(r.scanned).toBe(false);
  });

  it("recusa zip bomb em DOCX", async () => {
    await expect(extractText(fixture("zipbomb.docx"))).rejects.toMatchObject({
      code: expect.stringMatching(/timeout|too_large/),
    });
  });

  it("cria ExtractError com code estável", () => {
    expect(new ExtractError("empty").code).toBe("empty");
  });
});

describe("contact", () => {
  it("redactContact troca e-mail e telefone", () => {
    expect(redactContact("ana@x.com (11) 98888-7777")).toBe("[EMAIL] [TELEFONE]");
    expect(redactContact("fone +55 11 98888-7777, 11988887777")).toBe("fone [TELEFONE], [TELEFONE]");
  });

  it("redactContact não toca em anos nem números curtos", () => {
    expect(redactContact("2020-2026, 40% em 3 anos")).toBe("2020-2026, 40% em 3 anos");
  });

  it("extractContact acha e-mail, telefone e links", () => {
    const r = extractContact(
      "ana@x.com (11) 98888-7777 https://github.com/ana, www.linkedin.com/in/ana. e https://github.com/ana",
    );
    expect(r.email).toBe("ana@x.com");
    expect(r.phone).toBe("(11) 98888-7777");
    expect(r.links).toEqual(["https://github.com/ana", "https://www.linkedin.com/in/ana"]);
  });

  it("extractContact devolve nulos quando não há contato", () => {
    expect(extractContact("sem nada")).toEqual({ email: null, phone: null, links: [] });
  });

  it("links com esquema perigoso são ignorados", () => {
    expect(extractContact("javascript:alert(1) http://a.com/x").links).toEqual(["http://a.com/x"]);
  });
});
