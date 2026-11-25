import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// next/font só funciona dentro do compilador do Next; aqui basta um stub.
vi.mock("next/font/google", () => ({
  Inter: () => ({ variable: "--font-inter" }),
  Space_Grotesk: () => ({ variable: "--font-space-grotesk" }),
}));

import { viewport } from "@/app/layout";

describe("viewport", () => {
  it("tem viewportFit cover e themeColor nos dois temas", () => {
    expect(viewport).toMatchObject({
      viewportFit: "cover",
      themeColor: [
        { media: "(prefers-color-scheme: light)", color: "#f6f5f2" },
        { media: "(prefers-color-scheme: dark)", color: "#121418" },
      ],
    });
  });
});

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("link para pular ao conteúdo", () => {
  it("todo <main> de app/ e components/ tem id=\"conteudo\"", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components"]) {
      for (const file of tsxFiles(join(process.cwd(), dir))) {
        readFileSync(file, "utf8").split("\n").forEach((line, i) => {
          if (/<main\b/.test(line) && !line.includes('id="conteudo"')) offenders.push(`${file}:${i + 1}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
