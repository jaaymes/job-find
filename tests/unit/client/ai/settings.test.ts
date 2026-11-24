import { describe, expect, it } from "vitest";
import { AiSettings, defaultAiSettings } from "@/lib/client/ai/settings";

describe("AiSettings", () => {
  it("aceita source legado 'pkce' e lê como 'oauth'", () => {
    const s = AiSettings.parse({ ...defaultAiSettings(), providers: { openrouter: { key: "k", addedAt: "2026-01-01T00:00:00Z", source: "pkce" } } });
    expect(s.providers.openrouter?.source).toBe("oauth");
  });

  it("guarda refreshToken e expiresAt opcionais do OAuth", () => {
    const s = AiSettings.parse({
      ...defaultAiSettings(),
      providers: {
        openrouter: { key: "k", addedAt: "2026-01-01T00:00:00Z", source: "oauth", refreshToken: "r", expiresAt: "2026-02-01T00:00:00Z" },
      },
    });
    expect(s.providers.openrouter).toMatchObject({ source: "oauth", refreshToken: "r", expiresAt: "2026-02-01T00:00:00Z" });
  });

  it("recusa source desconhecido", () => {
    const r = AiSettings.safeParse({ ...defaultAiSettings(), providers: { openrouter: { key: "k", addedAt: "x", source: "outro" } } });
    expect(r.success).toBe(false);
  });
});
