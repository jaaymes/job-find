// Gera as fixtures de currículo de forma determinística (dados fictícios).
// Uso: node tests/fixtures/cv/generate.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import JSZip from "jszip";

const dir = dirname(fileURLToPath(import.meta.url));
const FIXED = new Date("2026-01-01T00:00:00Z");
const out = (name, bytes) => writeFileSync(join(dir, name), bytes);

async function newPdf() {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(FIXED);
  pdf.setModificationDate(FIXED);
  pdf.setProducer("job-find-fixtures");
  pdf.setCreator("job-find-fixtures");
  return pdf;
}

const linhas = [
  "Ana Exemplo - Desenvolvedora Full Stack",
  "ana.exemplo@exemplo.test | (11) 98888-7777 | https://github.com/ana-exemplo",
  "Resumo: desenvolvedora com seis anos de experiencia em TypeScript, React e Node.js,",
  "focada em produtos web de alto desempenho, acessibilidade e boas praticas de teste.",
  "Experiencia: Empresa Ficticia Ltda (2020-2026) - Desenvolvedora Pleno.",
  "Construiu APIs REST, pipelines de CI/CD e interfaces React com testes automatizados,",
  "reduzindo o tempo de carregamento em 40% e o numero de incidentes em producao.",
  "Formacao: Bacharelado em Sistemas de Informacao, Universidade Exemplo (2016-2019).",
  "Competencias: TypeScript, React, Next.js, Node.js, PostgreSQL, Docker, Git.",
];

// texto.pdf: uma página com camada de texto suficiente.
{
  const pdf = await newPdf();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  linhas.forEach((l, i) => page.drawText(l, { x: 40, y: 800 - i * 18, size: 10, font }));
  out("texto.pdf", await pdf.save({ useObjectStreams: false }));
}

// colunas.pdf: duas colunas de texto na mesma página.
{
  const pdf = await newPdf();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595, 842]);
  linhas.slice(0, 5).forEach((l, i) => page.drawText(l.slice(0, 40), { x: 40, y: 800 - i * 18, size: 10, font }));
  linhas.slice(5).forEach((l, i) => page.drawText(l.slice(0, 40), { x: 320, y: 800 - i * 18, size: 10, font }));
  out("colunas.pdf", await pdf.save({ useObjectStreams: false }));
}

// escaneado.pdf: só uma imagem, sem camada de texto.
{
  const w = 64, h = 64;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0xee);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
  const pdf = await newPdf();
  const img = await pdf.embedPng(png);
  const page = pdf.addPage([595, 842]);
  page.drawImage(img, { x: 40, y: 400, width: 500, height: 400 });
  out("escaneado.pdf", await pdf.save({ useObjectStreams: false }));
}

// fake.pdf: extensão .pdf, mas o conteúdo não é PDF.
out("fake.pdf", Buffer.from("Isto nao e um PDF, apenas texto simples com extensao .pdf\n"));

const docxBase = (zip, bodyXml) => {
  zip.file("[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`);
};
const p = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const zipOpts = { type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } };
const zdate = { date: FIXED, createFolders: false };

// cv.docx
{
  const zip = new JSZip();
  const corpo = ["Ana Exemplo", "ana.exemplo@exemplo.test | (11) 98888-7777",
    "Experiência", "Empresa Ficticia Ltda (2020-2026) - Desenvolvedora Pleno.",
    "Formação", "Bacharelado em Sistemas de Informação.",
    "Competências", "TypeScript, React, Node.js, PostgreSQL."].map(p).join("");
  docxBase({ file: (n, c) => zip.file(n, c, zdate) }, corpo);
  out("cv.docx", await zip.generateAsync(zipOpts));
}

// zipbomb.docx: poucos KB comprimidos, dezenas de MB expandidos.
{
  const zip = new JSZip();
  docxBase({ file: (n, c) => zip.file(n, c, zdate) }, p("Ana Exemplo"));
  zip.file("word/media/lixo.bin", Buffer.alloc(64 * 1024 * 1024, 0), zdate);
  out("zipbomb.docx", await zip.generateAsync(zipOpts));
}
// vazio.docx: DOCX válido sem nenhum texto.
{
  const zip = new JSZip();
  docxBase({ file: (n, c) => zip.file(n, c, zdate) }, "<w:p/>");
  out("vazio.docx", await zip.generateAsync(zipOpts));
}

// zipbomb-mentiroso.docx: o word/document.xml real tem dezenas de MB, mas os tamanhos declarados no
// cabeçalho são pequenos (o mammoth só infla o que lê, então a bomba precisa estar no document.xml).
{
  const zip = new JSZip();
  docxBase({ file: (n, c) => zip.file(n, c, zdate) }, "");
  const par = p("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';
  const tail = "</w:body></w:document>";
  const body = par.repeat(Math.ceil((64 * 1024 * 1024) / par.length));
  zip.file("word/document.xml", head + body + tail, zdate);
  const buf = Buffer.from(await zip.generateAsync(zipOpts));
  // Cabeçalho local (0x04034b50, tamanho em +22) e diretório central (0x02014b50, tamanho em +24, offset local em +42).
  for (let i = 0; i + 46 < buf.length; i++) {
    if (buf.readUInt32LE(i) === 0x02014b50 && buf.readUInt32LE(i + 24) > 1000) {
      buf.writeUInt32LE(1000, i + 24);
      buf.writeUInt32LE(1000, buf.readUInt32LE(i + 42) + 22);
    }
  }
  out("zipbomb-mentiroso.docx", buf);
}

// muitas-paginas.pdf: 11 páginas (acima do limite de 10).
{
  const pdf = await newPdf();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 11; n++) {
    const page = pdf.addPage([595, 842]);
    page.drawText(`Pagina ${n} do curriculo ficticio de Ana Exemplo`, { x: 40, y: 800, size: 10, font });
  }
  out("muitas-paginas.pdf", await pdf.save({ useObjectStreams: false }));
}
console.log("fixtures geradas em", dir);
