// @vitest-environment node
import { resolve } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import type { AssembledCv } from "@/lib/client/cv/assemble";
import { SECTION_LABELS } from "@/lib/client/pdf/CvDocument";
import { renderCvPdf } from "@/lib/client/pdf/render";
import { CV_TEMPLATES, getTemplate } from "@/lib/client/pdf/templates/registry";

const FONTS = resolve(import.meta.dirname, "../../../public/fonts");
const OK = { key: "k", flagged: false, violations: [] };
const FL = { flagged: false, violations: [] };
const HEADLINE = "Engenheira Frontend Sênior";
const HIGHLIGHT = "Reduziu o tempo de build em 60% com cache incremental.";

const fullCv = (over: Partial<AssembledCv> = {}): AssembledCv => ({
  name: "Ana Souza",
  contactLine: "ana@exemplo.test | +55 11 91234-5678 | São Paulo, SP | github.com/ana",
  location: "São Paulo, SP",
  headline: HEADLINE,
  summary: "Ação, São, Español – Niño: oito anos construindo interfaces acessíveis.",
  skills: ["React", "TypeScript", "Node.js", "Liderança"],
  education: ["Ciência da Computação – USP (2012 – 2016) – Ação, Español, Niño"],
  projects: [
    { name: "Painel Aberto", link: "github.com/ana/painel", stacks: ["React", "D3"], bullets: ["Painel público de dados de transporte."] },
    { name: "Gerador de CV", link: null, stacks: ["Next.js"], bullets: ["Gera PDFs legíveis pelo ATS."] },
  ],
  certifications: ["AWS Cloud Practitioner – AWS (2022)"],
  languages: ["Inglês – Fluente", "Espanhol – Básico"],
  highlightKeys: ["b1"],
  lang: "pt",
  experiences: [
    {
      expId: "exp_1",
      occurrence: 0,
      company: "Lumen Pay",
      role: "Frontend Sênior",
      period: "jan 2021 – atual",
      bullets: [
        { key: "b1", text: HIGHLIGHT, sources: ["exp_1.b1"], ...FL },
        { key: "b2", text: "Liderou a migração para Next.js.", sources: [], ...FL },
      ],
    },
    {
      expId: "exp_2",
      occurrence: 0,
      company: "Beta Labs",
      role: "Desenvolvedora",
      period: "2018 – 2020",
      bullets: [{ key: "b3", text: "Criou a biblioteca de componentes.", sources: [], ...FL }],
    },
  ],
  flags: { headline: OK, summary: OK, skills: [OK, OK, OK, OK] },
  ...over,
});

async function render(cv: AssembledCv, id: string): Promise<{ text: string; info: Record<string, unknown> }> {
  const { blob } = await renderCvPdf(cv, id as never, FONTS);
  const doc = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
  const text = (await extractText(doc, { mergePages: true })).text;
  const meta = await doc.getMetadata();
  return { text, info: meta.info as Record<string, unknown> };
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

describe("registro de templates", () => {
  it("tem os 10 ids na ordem e getTemplate cai em classico", () => {
    expect(CV_TEMPLATES.map((t) => t.id)).toEqual([
      "classico", "compacto", "harvard", "minimalista", "moderno", "resultados", "lideranca", "inicio-de-carreira", "transicao", "internacional",
    ]);
    expect(CV_TEMPLATES).toHaveLength(10);
    expect(getTemplate("nao-existe").id).toBe("classico");
    expect(getTemplate(null).id).toBe("classico");
    expect(getTemplate(undefined).id).toBe("classico");
    expect(getTemplate("harvard").id).toBe("harvard");
  });

  it.each(CV_TEMPLATES)("$id: contraste do acento >= 4.5:1 sobre branco", (t) => {
    expect((1.05) / (luminance(t.tokens.accent) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("templates de CV", () => {
  it.each(CV_TEMPLATES)("$id: ordem legível pelo ATS", async (t) => {
    const { text } = await render(fullCv(), t.id);
    const low = text.toLowerCase();
    // Nome, headline e e-mail: primeira ocorrência. Rótulos: linha própria, buscada depois do índice anterior.
    const idx = ["ana souza", HEADLINE.toLowerCase(), "ana@exemplo.test"].map((x) => low.indexOf(x));
    for (const i of idx) expect(i).toBeGreaterThanOrEqual(0);
    let from = Math.max(...idx);
    for (const sec of t.sections) {
      const label = SECTION_LABELS.pt[sec].toLowerCase();
      const m = new RegExp(`(?:^|\\n)${label}(?:\\n|$)`).exec(low.slice(from));
      expect(m, `título "${label}" em linha própria`).not.toBeNull();
      from += (m?.index ?? 0) + 1;
      idx.push(from);
    }
    expect([...idx].sort((x, y) => x - y)).toEqual(idx);
    expect(text).toMatch(/[\w.]+@[\w.]+/);
    expect(text).toMatch(/\+55 11 91234-5678/);
    expect(text).not.toMatch(/\p{L}-\n\p{L}/u);
    for (const w of ["Ação", "Español", "Niño"]) expect(text).toContain(w);
  });

  it.each(CV_TEMPLATES)("$id: seta no bullet e texto NFD saem como NFC no PDF", async (t) => {
    const nfd = "Ação".normalize("NFD");
    expect(nfd).not.toBe("Ação");
    const base = fullCv();
    const cv = fullCv({
      summary: `${nfd} em equipe.`,
      education: [`${nfd} – USP`],
      experiences: base.experiences.map((x, i) =>
        i === 0 ? { ...x, bullets: [{ ...x.bullets[0], text: `Migrou legado → Next.js ≥ 14 ✓ ${nfd}.` }, ...x.bullets.slice(1)] } : x,
      ),
    });
    const { text } = await render(cv, t.id);
    expect(text).toContain("→");
    expect(text).toContain("≥");
    expect(text).toContain("Ação");
    expect(text).not.toContain(nfd);
  });

  it.each(CV_TEMPLATES)("$id: perfil mínimo sem título vazio", async (t) => {
    const cv = fullCv({
      contactLine: "",
      location: "",
      headline: "",
      summary: "",
      skills: [],
      education: [],
      projects: [],
      certifications: [],
      languages: [],
      highlightKeys: [],
      experiences: [],
      flags: { headline: OK, summary: OK, skills: [] },
    });
    const { text } = await render(cv, t.id);
    expect(text).toContain("Ana Souza");
    for (const label of Object.values(SECTION_LABELS.pt)) expect(text.toLowerCase()).not.toContain(label.toLowerCase());
  });

  it("resultados: destaque aparece uma vez, entre Destaques e Experiência", async () => {
    const { text } = await render(fullCv(), "resultados");
    expect(text.split(HIGHLIGHT)).toHaveLength(2);
    const i = text.indexOf(HIGHLIGHT);
    expect(text.indexOf("Destaques")).toBeLessThan(i);
    expect(i).toBeLessThan(text.indexOf("Experiência"));
  });

  it("internacional em inglês: linha Location e rótulos em inglês", async () => {
    const { text } = await render(fullCv({ lang: "en" }), "internacional");
    expect(text).toContain("Location: São Paulo, SP · Open to remote");
    expect(text).toContain("Experience");
  });

  it("metadados do PDF", async () => {
    const { info } = await render(fullCv(), "classico");
    expect(info.Title).toBe("CV Ana Souza");
    expect(info.Author).toBe("Ana Souza");
    expect(info.Subject).toBe(HEADLINE);
    expect(String(info.Keywords)).toContain("React");
  });

  it("compacto agrupa competências por categoria", async () => {
    const { text } = await render(fullCv(), "compacto");
    expect(text).toContain("Front-end: React");
    expect(text).toContain("Outras: Liderança");
  });
});
