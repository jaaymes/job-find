import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../../..");
const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");

/** Extrai as variáveis `--jf-*` (hex) do primeiro bloco cujo seletor é exatamente `selector`. */
function jfVars(selector: string): Record<string, string> {
  const re = new RegExp(`(^|\\n)${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`);
  const block = re.exec(css)?.[2];
  if (!block) throw new Error(`bloco ${selector} não encontrado em globals.css`);
  const vars: Record<string, string> = {};
  for (const m of block.matchAll(/--jf-([a-z0-9-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

/** Luminância relativa WCAG 2.x de um hex #rgb/#rrggbb. */
function luminance(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`cor não é hex: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [texto, fundo]
const PAIRS: [string, string][] = [
  ["ink", "bg"],
  ["ink-2", "surface"],
  ["ink-3", "surface"],
  ["brand", "surface"],
  ["new-fg", "new-bg"],
  ["media-fg", "media-bg"],
  ["baixa-fg", "baixa-bg"],
  ["danger-fg", "danger-bg"],
  // Combinações usadas nos componentes além das do plano.
  ["ink-3", "bg"],
  ["surface", "brand"], // botões primários: texto `text-jf-surface` sobre `bg-jf-brand`
  ["surface", "brand-dark"], // hover dos botões primários
  ["surface", "ink"], // logo, toast e botões escuros
  ["surface", "alta"], // badge de chance alta
  ["alta", "surface"], // texto de sucesso
  ["brand-dark", "surface"], // links em hover
  ["new-fg", "surface"],
  ["warn-fg", "surface"], // título "Lacunas"
  ["warn-fg-strong", "new-bg"], // nota de privacidade
  ["ink", "surface-2"], // área de soltar arquivo
];

describe.each([":root", ".dark"])("paleta %s", (selector) => {
  const vars = jfVars(selector);

  it.each(PAIRS)("%s sobre %s tem contraste >= 4,5:1", (fg, bg) => {
    expect(vars[fg], `--jf-${fg} ausente em ${selector}`).toBeDefined();
    expect(vars[bg], `--jf-${bg} ausente em ${selector}`).toBeDefined();
    expect(contrast(vars[fg], vars[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("tokens da paleta", () => {
  it("todo --jf-* de :root é redefinido em .dark", () => {
    expect(Object.keys(jfVars(".dark")).sort()).toEqual(Object.keys(jfVars(":root")).sort());
  });

  it("as utilities --color-jf-* apontam para as variáveis --jf-*", () => {
    const theme = [...css.matchAll(/--color-jf-([a-z0-9-]+)\s*:\s*([^;]+);/g)];
    expect(theme.length).toBeGreaterThan(0);
    for (const [, name, value] of theme) expect(value.trim()).toBe(`var(--jf-${name})`);
  });
});

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("cores fixas nos componentes", () => {
  // lib/client/pdf fica de fora da varredura (só components/ e app/): o PDF do CV continua claro.
  const files = [...tsxFiles(join(ROOT, "components")), ...tsxFiles(join(ROOT, "app"))];

  it("nenhum .tsx de components/ e app/ usa hex, bg-white ou text-white", () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/#[0-9a-fA-F]{3,8}\b|\bbg-white\b|\btext-white\b/.test(line)) {
            offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
