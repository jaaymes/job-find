import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SANITIZER_VERSION,
  htmlToText,
  markdownToSafeHtml,
  sanitizeJobHtml,
  summarize,
} from "@/lib/server/sanitize";
import {
  ALLOWED_SCHEMES,
  ALLOWED_TAGS,
  MAX_HTML_BYTES,
} from "@/lib/shared/sanitize-policy";

const payloads = readFileSync(
  resolve(import.meta.dirname, "../../fixtures/xss/payloads.txt"),
  "utf8",
)
  .split("\n")
  .filter((l) => l.length > 0);

/**
 * O regex proibido do brief é aplicado ao MARKUP da saída, não ao texto: um
 * "javascript:" que sobrou como texto escapado (ex.: `<p>javascript:alert(1)</p>`)
 * é inofensivo. Por isso removemos o texto entre as tags antes de testar. Os
 * valores de atributo continuam dentro das tags e, portanto, são verificados.
 */
const FORBIDDEN = /<script|onerror=|onload=|javascript:|<iframe|<svg|<img|style=/i;

function stripText(out: string): string {
  return out.replace(/^[^<]*/, "").replace(/>[^<]*/g, ">");
}

/** Verificação estrutural por regex: só tags da allowlist, só href(+rel) em `a`, só esquemas permitidos. */
function assertStructure(out: string) {
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/g;
  const allowed = new Set<string>(ALLOWED_TAGS);
  const markup = stripText(out);
  // Tudo o que sobra de markup tem de ser tag bem formada.
  expect(markup.replace(tagRe, "")).toBe("");
  for (const m of out.matchAll(tagRe)) {
    expect(allowed.has(m[1].toLowerCase())).toBe(true);
    for (const a of m[2].matchAll(/\s+([^\s=>]+)(?:="([^"]*)")?/g)) {
      const name = a[1].toLowerCase();
      expect(m[1].toLowerCase()).toBe("a");
      expect(["href", "rel"]).toContain(name);
      if (name === "href") {
        const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(a[2] ?? "")?.[1]?.toLowerCase();
        expect(scheme && ALLOWED_SCHEMES.includes(scheme as never)).toBe(true);
      }
    }
  }
}

describe("corpus XSS", () => {
  it("tem pelo menos 80 payloads", () => {
    expect(payloads.length).toBeGreaterThanOrEqual(80);
  });

  for (const dofollow of [false, true]) {
    it(`sanitizeJobHtml neutraliza todos os payloads (dofollow=${dofollow})`, () => {
      for (const p of payloads) {
        const out = sanitizeJobHtml(p, { dofollow });
        expect(stripText(out), p).not.toMatch(FORBIDDEN);
        expect(stripText(out), p).not.toMatch(/<(script|iframe|svg|img|style|object|embed|form|meta|base|link|math)\b/i);
        expect(stripText(out), p).not.toMatch(/\son[a-z]+\s*=/i);
        assertStructure(out);
      }
    });
  }

  it("markdownToSafeHtml neutraliza todos os payloads", () => {
    for (const p of payloads) {
      const out = markdownToSafeHtml(p);
      expect(stripText(out), p).not.toMatch(FORBIDDEN);
      assertStructure(out);
    }
  });
});

describe("sanitizeJobHtml", () => {
  it("exporta a versão do sanitizador", () => {
    expect(SANITIZER_VERSION).toBe(1);
  });

  it("adiciona rel nofollow por padrão e omite com dofollow", () => {
    expect(sanitizeJobHtml('<a href="https://x.com">x</a>', { dofollow: false })).toContain(
      'rel="noopener noreferrer nofollow"',
    );
    const df = sanitizeJobHtml('<a href="https://x.com">x</a>', { dofollow: true });
    expect(df).not.toContain("nofollow");
    expect(df).toContain('rel="noopener noreferrer"');
  });

  it("não deixa target, class, style nem id", () => {
    const out = sanitizeJobHtml(
      '<a href="https://x.com" target="_blank" class="c" style="x:y" id="i" rel="opener">x</a>',
      { dofollow: false },
    );
    expect(out).toBe('<a href="https://x.com" rel="noopener noreferrer nofollow">x</a>');
  });

  it("mantém a formatação permitida", () => {
    const html = "<p>a <strong>b</strong> <em>c</em></p><ul><li>d</li></ul><h3>t</h3><pre><code>x</code></pre><blockquote>q</blockquote>";
    expect(sanitizeJobHtml(html, { dofollow: false })).toBe(html);
  });

  it("aceita mailto e rejeita esquemas fora da allowlist", () => {
    expect(sanitizeJobHtml('<a href="mailto:a@b.co">x</a>', { dofollow: false })).toContain("mailto:a@b.co");
    expect(sanitizeJobHtml('<a href="ftp://x.co">x</a>', { dofollow: false })).not.toContain("href");
    expect(sanitizeJobHtml('<a href="//x.co">x</a>', { dofollow: false })).not.toContain("href");
  });

  it("descarta o conteúdo de script/style/iframe/svg/object e desembrulha o resto", () => {
    expect(sanitizeJobHtml("a<script>evil()</script>b", { dofollow: false })).toBe("ab");
    expect(sanitizeJobHtml("a<style>p{}</style>b", { dofollow: false })).toBe("ab");
    expect(sanitizeJobHtml("a<iframe>x</iframe>b", { dofollow: false })).toBe("ab");
    expect(sanitizeJobHtml("a<svg><text>x</text></svg>b", { dofollow: false })).toBe("ab");
    expect(sanitizeJobHtml("a<object>x</object>b", { dofollow: false })).toBe("ab");
    expect(sanitizeJobHtml("<div>texto <span>mantido</span></div>", { dofollow: false })).toBe("texto mantido");
  });

  it("trunca em 30.000 bytes, fechando tags, e o resultado é bem formado", () => {
    const html = "<ul>" + "<li><strong>ação ✓ item</strong> texto</li>".repeat(4000) + "</ul>";
    expect(Buffer.byteLength(html)).toBeGreaterThan(100_000);
    const out = sanitizeJobHtml(html, { dofollow: false });
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(MAX_HTML_BYTES);
    expect(Buffer.byteLength(out)).toBeGreaterThan(MAX_HTML_BYTES - 200);
    expect(out.endsWith("</ul>")).toBe(true);
    expect(sanitizeJobHtml(out, { dofollow: false })).toBe(out);
    expect(out).not.toContain("�");
  });

  it("trunca texto puro grande sem cortar entidades", () => {
    const out = sanitizeJobHtml("<p>" + "a&amp;b ".repeat(20000) + "</p>", { dofollow: false });
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(MAX_HTML_BYTES);
    expect(sanitizeJobHtml(out, { dofollow: false })).toBe(out);
  });
});

describe("markdownToSafeHtml", () => {
  it("renderiza markdown", () => {
    const out = markdownToSafeHtml("# Título\n\n**negrito** e [link](https://x.com)\n\n- a\n- b");
    expect(out).toContain("<strong>negrito</strong>");
    expect(out).toContain('href="https://x.com"');
    expect(out).toContain("nofollow");
    expect(out).toContain("<li>a</li>");
  });

  it("não deixa HTML cru passar: vira texto escapado", () => {
    const out = markdownToSafeHtml("oi <script>alert(1)</script> <b>x</b>");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<b>x</b>");
  });

  it("remove imagens e links javascript:", () => {
    const out = markdownToSafeHtml("![x](https://x.com/a.png) [y](javascript:alert(1))");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("href=");
  });
});

describe("htmlToText / summarize", () => {
  it("htmlToText decodifica entidades e colapsa espaços", () => {
    expect(htmlToText("<p>a &amp; b</p>\n\n<p>  c&nbsp;d &lt;e&gt; &#233; </p>")).toBe("a & b c d <e> é");
  });

  it("htmlToText separa blocos e ignora script", () => {
    expect(htmlToText("<p>a</p><p>b</p><ul><li>c</li><li>d</li></ul>x<script>y()</script>")).toBe("a b c d x");
  });

  it("summarize respeita o limite", () => {
    expect(summarize("<p>" + "a ".repeat(400) + "</p>").length).toBeLessThanOrEqual(280);
  });

  it("summarize corta em palavra e conta a reticência no limite", () => {
    const s = summarize("<p>uma frase razoavelmente longa para testar o corte</p>", 20);
    expect(s.length).toBeLessThanOrEqual(20);
    expect(s.endsWith("…")).toBe(true);
    expect(s).toBe("uma frase…");
  });

  it("summarize não altera textos curtos", () => {
    expect(summarize("<p>curto</p>")).toBe("curto");
  });
});
