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
