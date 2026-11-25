import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toSafeHtml } from "@/lib/client/render-html";
import { ALLOWED_SCHEMES, ALLOWED_TAGS } from "@/lib/shared/sanitize-policy";

const payloads = readFileSync(
  resolve(import.meta.dirname, "../../fixtures/xss/payloads.txt"),
  "utf8",
)
  .split("\n")
  .filter((l) => l.length > 0);

// O regex proibido vale para o MARKUP, não para o texto (ver sanitize.test.ts):
// removemos o texto entre as tags e depois verificamos a estrutura parseada no jsdom.
const FORBIDDEN = /<script|onerror=|onload=|javascript:|<iframe|<svg|<img|style=/i;
const stripText = (out: string) => out.replace(/^[^<]*/, "").replace(/>[^<]*/g, ">");

describe("toSafeHtml (jsdom)", () => {
  it("neutraliza todo o corpus XSS", () => {
    expect(payloads.length).toBeGreaterThanOrEqual(80);
    const allowed = new Set<string>(ALLOWED_TAGS);
    for (const p of payloads) {
      const out = toSafeHtml(p);
      expect(stripText(out), p).not.toMatch(FORBIDDEN);

      const doc = new DOMParser().parseFromString(`<body>${out}</body>`, "text/html");
      for (const el of Array.from(doc.body.querySelectorAll("*"))) {
        expect(allowed.has(el.tagName.toLowerCase()), `${p} -> <${el.tagName}>`).toBe(true);
        for (const attr of Array.from(el.attributes)) {
          expect(el.tagName).toBe("A");
          expect(["href", "rel"], p).toContain(attr.name);
          if (attr.name === "href") {
            const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(attr.value)?.[1]?.toLowerCase();
            expect(scheme && ALLOWED_SCHEMES.includes(scheme as never), `${p} -> ${attr.value}`).toBe(true);
          }
        }
      }
    }
  });

  it("adiciona rel e mantém a formatação", () => {
    expect(toSafeHtml('<p>a <a href="https://x.com" target="_blank">x</a></p>')).toBe(
      '<p>a <a href="https://x.com" rel="noopener noreferrer nofollow">x</a></p>',
    );
  });

  it("descarta o conteúdo de elementos perigosos e desembrulha o resto", () => {
    expect(toSafeHtml("a<script>evil()</script>b<style>p{}</style>c<iframe>x</iframe>d")).toBe("abcd");
    expect(toSafeHtml("<div>texto <span>mantido</span></div>")).toBe("texto mantido");
  });

  it("é idempotente sobre a saída do servidor", () => {
    const html = '<p>a <strong>b</strong> <a href="mailto:a@b.co" rel="noopener noreferrer nofollow">m</a></p>';
    expect(toSafeHtml(html)).toBe(html);
  });

  it("dofollow mantém rel sem nofollow; o padrão é nofollow", () => {
    const a = '<a href="https://x.com">x</a>';
    expect(toSafeHtml(a, { dofollow: true })).toBe('<a href="https://x.com" rel="noopener noreferrer">x</a>');
    expect(toSafeHtml(a)).toBe('<a href="https://x.com" rel="noopener noreferrer nofollow">x</a>');
    expect(toSafeHtml(a, { dofollow: false })).toContain("nofollow");
  });

  it("sobrescreve um rel vindo no HTML", () => {
    const a = '<a href="https://x.com" rel="noopener">x</a>';
    expect(toSafeHtml(a)).toBe('<a href="https://x.com" rel="noopener noreferrer nofollow">x</a>');
    expect(toSafeHtml(a, { dofollow: true })).toBe('<a href="https://x.com" rel="noopener noreferrer">x</a>');
  });
});

describe("toSafeHtml com paragraphs", () => {
  it("toSafeHtml com paragraphs transforma \\n\\n em <p>", () => {
    expect(toSafeHtml("Primeiro trecho.\n\nSegundo trecho.", { paragraphs: true })).toBe(
      "<p>Primeiro trecho.</p><p>Segundo trecho.</p>",
    );
  });

  it("mantém blocos que já são HTML e não mexe no texto sem a opção", () => {
    expect(toSafeHtml("<p>a</p>\n\n<ul><li>b</li></ul>", { paragraphs: true })).toBe("<p>a</p><ul><li>b</li></ul>");
    expect(toSafeHtml("a\n\nb")).toBe("a\n\nb");
  });
});
