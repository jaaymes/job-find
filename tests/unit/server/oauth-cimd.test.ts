import { describe, expect, it } from "vitest";
import { cimdOrigin } from "@/lib/server/cimd";
import { GET } from "@/app/.well-known/oauth-cimd/route";

const req = (url: string) => new Request(url);

describe("GET /.well-known/oauth-cimd", () => {
  it("devolve client_id igual à própria URL e redirect_uris com /configuracoes/callback", async () => {
    const res = await GET(req("https://jobfind.example/.well-known/oauth-cimd"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      client_id: "https://jobfind.example/.well-known/oauth-cimd",
      client_name: "Job Find",
      redirect_uris: ["https://jobfind.example/configuracoes/callback"],
      token_endpoint_auth_method: "none",
      client_uri: "https://jobfind.example",
      logo_uri: "https://jobfind.example/icon.svg",
    });
  });

  it("recusa origem http que não é localhost", async () => {
    expect((await GET(req("http://evil.example/.well-known/oauth-cimd"))).status).toBe(400);
  });

  it("aceita localhost e 127.0.0.1 com porta em http", async () => {
    for (const origin of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
      const res = await GET(req(`${origin}/.well-known/oauth-cimd`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.client_id).toBe(`${origin}/.well-known/oauth-cimd`);
      expect(body.redirect_uris).toEqual([`${origin}/configuracoes/callback`]);
    }
  });
});

describe("cimdOrigin", () => {
  it("só aceita https ou http local com porta", () => {
    expect(cimdOrigin(req("https://a.example/x"))).toBe("https://a.example");
    expect(cimdOrigin(req("http://localhost:3000/x"))).toBe("http://localhost:3000");
    expect(cimdOrigin(req("http://localhost/x"))).toBeNull();
    expect(cimdOrigin(req("http://localhost.evil.example:3000/x"))).toBeNull();
    expect(cimdOrigin(req("http://evil.example/x"))).toBeNull();
  });
});
