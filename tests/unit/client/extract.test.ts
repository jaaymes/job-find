import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { extractContact, redactContact } from "@/lib/client/extract/contact";
import { ExtractError, extractText as realExtractText, type ExtractOptions, type WorkerLike } from "@/lib/client/extract";
import { extractCore } from "@/lib/client/extract/extract-core";

const fixture = (name: string, type = "") => {
  const bytes = readFileSync(resolve(import.meta.dirname, "../../fixtures/cv", name));
  return new File([new Uint8Array(bytes)], name, { type });
};

/** Worker falso que executa a lógica real (extractCore) na mesma thread. */
function inlineWorker(): WorkerLike {
  const w: WorkerLike = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    terminate: vi.fn(),
    postMessage(msg) {
      const { kind, bytes } = msg as { kind: "pdf" | "docx"; bytes: Uint8Array };
      extractCore(bytes, kind).then(
        (result) => w.onmessage?.({ data: { ok: true, result } }),
        (e: { code?: string }) => w.onmessage?.({ data: { ok: false, code: e.code } }),
      );
    },
  };
  return w;
}
const opts: ExtractOptions = { createWorker: inlineWorker };
const extractText = (f: File, o: ExtractOptions = opts) => realExtractText(f, o);

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

  it("rejeita DOCX com magic bytes errados (bad_type)", async () => {
    const f = new File([new Uint8Array(readFileSync(resolve(import.meta.dirname, "../../fixtures/cv/fake.pdf")))], "cv.docx");
    await expect(extractText(f)).rejects.toMatchObject({ code: "bad_type" });
  });

  it("rejeita PDF com mais de 10 páginas (too_many_pages)", async () => {
    await expect(extractText(fixture("muitas-paginas.pdf"))).rejects.toMatchObject({ code: "too_many_pages" });
  });

  it("DOCX sem texto vira empty", async () => {
    await expect(extractText(fixture("vazio.docx"))).rejects.toMatchObject({ code: "empty" });
  });

  it("zip bomb com tamanhos declarados mentirosos não passa (teto ou erro de integridade)", async () => {
    await expect(extractText(fixture("zipbomb-mentiroso.docx"))).rejects.toMatchObject({
      code: expect.stringMatching(/timeout|too_large|bad_type/),
    });
  }, 30_000);

  it("no timeout encerra o worker (terminate) e rejeita com timeout", async () => {
    const terminate = vi.fn();
    const hang: WorkerLike = { onmessage: null, onerror: null, onmessageerror: null, terminate, postMessage: () => undefined };
    await expect(extractText(fixture("texto.pdf"), { createWorker: () => hang, timeoutMs: 30 })).rejects.toMatchObject({
      code: "timeout",
    });
    expect(terminate).toHaveBeenCalledTimes(1);
  });

  it("encerra o worker também ao terminar com sucesso", async () => {
    const w = inlineWorker();
    await realExtractText(fixture("cv.docx"), { createWorker: () => w });
    expect(w.terminate).toHaveBeenCalledTimes(1);
  });

  it("ignora mensagens de protocolo do bundler (ex.: Turbopack 'ready') e espera a resposta real", async () => {
    const w = inlineWorker();
    const post = w.postMessage.bind(w);
    w.postMessage = (msg, t) => {
      w.onmessage?.({ data: { sourceName: "worker", targetName: "main", action: "ready", data: {} } });
      post(msg, t);
    };
    const r = await realExtractText(fixture("texto.pdf"), { createWorker: () => w });
    expect(r.kind).toBe("pdf");
  });

  it("erro do worker vira ExtractError estável", async () => {
    const w: WorkerLike = { onmessage: null, onerror: null, onmessageerror: null, terminate: vi.fn(), postMessage: () => w.onerror?.({}) };
    await expect(realExtractText(fixture("texto.pdf"), { createWorker: () => w })).rejects.toMatchObject({ code: "failed" });
    expect(w.terminate).toHaveBeenCalled();
  });

  it("postMessage que lança vira failed e encerra o worker", async () => {
    const w: WorkerLike = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      terminate: vi.fn(),
      postMessage: () => {
        throw new Error("DataCloneError");
      },
    };
    await expect(realExtractText(fixture("texto.pdf"), { createWorker: () => w })).rejects.toMatchObject({ code: "failed" });
    expect(w.terminate).toHaveBeenCalledTimes(1);
  });

  it("falha ao criar o worker vira failed", async () => {
    const createWorker = () => {
      throw new Error("sem worker");
    };
    await expect(realExtractText(fixture("texto.pdf"), { createWorker })).rejects.toMatchObject({ code: "failed" });
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

  it("redactContact cobre telefones internacionais e separadores com espaço", () => {
    expect(redactContact("+1 415 555 0123")).toBe("[TELEFONE]");
    expect(redactContact("+351 912 345 678")).toBe("[TELEFONE]");
    expect(redactContact("+44 7700 900123")).toBe("[TELEFONE]");
    expect(redactContact("(11) 98888 - 7777")).toBe("[TELEFONE]");
    expect(redactContact("Tel: (11) 98888-7777.")).toBe("Tel: [TELEFONE].");
  });

  it("redactContact acha o telefone mesmo após anos vizinhos", () => {
    expect(redactContact("em 2020 2026 (11) 98888-7777")).toBe("em 2020 2026 [TELEFONE]");
  });

  it("redactContact cobre e-mail com acentos e não toca números em URLs", () => {
    expect(redactContact("joão.silva@x.com")).toBe("[EMAIL]");
    expect(redactContact("linkedin.com/in/ana-98888777 e https://linkedin.com/in/ana-98888777")).toBe(
      "linkedin.com/in/ana-98888777 e https://linkedin.com/in/ana-98888777",
    );
  });

  it("redactContact é linear em 30k caracteres sem @ nem dígitos", () => {
    const t0 = performance.now();
    redactContact("a".repeat(30_000));
    redactContact("1 ".repeat(15_000));
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it("redactContact redige o número em URLs de WhatsApp e parâmetros de telefone", () => {
    expect(redactContact("https://wa.me/5511988887777")).toBe("https://wa.me/[TELEFONE]");
    expect(redactContact("api.whatsapp.com/send?phone=5511988887777")).toBe("api.whatsapp.com/send?phone=[TELEFONE]");
    expect(redactContact("https://x.com/c?tel=11988887777&a=1")).toBe("https://x.com/c?tel=[TELEFONE]&a=1");
    expect(redactContact("https://x.com/id/5511988887777")).toBe("https://x.com/id/[TELEFONE]");
  });

  it("redactContact preserva períodos mês/ano e anos vizinhos", () => {
    expect(redactContact("01.2020 - 12.2023")).toBe("01.2020 - 12.2023");
    expect(redactContact("03-2019 - 05-2021")).toBe("03-2019 - 05-2021");
    expect(redactContact("2020-2026 e 05/2021")).toBe("2020-2026 e 05/2021");
    expect(redactContact("1999 - 2003 98888-7777")).toBe("1999 - 2003 [TELEFONE]");
    expect(redactContact("Dev (01.2020 - 12.2023) (11) 98888-7777")).toBe("Dev (01.2020 - 12.2023) [TELEFONE]");
  });

  it("redactContact ignora NUL pré-existente sem corromper URLs", () => {
    expect(redactContact("a\u0000b https://x.com/in/ana-1\u00000")).toBe("ab https://x.com/in/ana-10");
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
