import { describe, expect, it } from "vitest";
import { cimdOrigin } from "@/lib/server/cimd";
import { GET } from "@/app/.well-known/oauth-cimd/route";

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

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
    const res = await GET(req("http://evil.example/.well-known/oauth-cimd"));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("usa x-forwarded-host e x-forwarded-proto atrás de túnel", async () => {
    const res = await GET(
      req("http://localhost:3456/.well-known/oauth-cimd", {
        "x-forwarded-host": "app.ngrok-free.dev",
        "x-forwarded-proto": "https",
      }),
    );
    const body = await res.json();
    expect(body.client_id).toBe("https://app.ngrok-free.dev/.well-known/oauth-cimd");
    expect(body.redirect_uris).toEqual(["https://app.ngrok-free.dev/configuracoes/callback"]);
  });

  it("usa só o header host em https", async () => {
    const res = await GET(
      req("http://localhost:3456/.well-known/oauth-cimd", { host: "jobfind.example" }),
    );
    expect((await res.json()).client_id).toBe("https://jobfind.example/.well-known/oauth-cimd");
  });

  it("recusa x-forwarded-host com lixo", async () => {
    const res = await GET(
      req("https://jobfind.example/.well-known/oauth-cimd", { "x-forwarded-host": "evil.example/x@y" }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
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
    expect(cimdOrigin(req("http://localhost:80/x"))).toBeNull();
    expect(cimdOrigin(req("http://[::1]:3000/x"))).toBeNull();
    expect(cimdOrigin(req("ftp://localhost:21/x"))).toBeNull();
    expect(cimdOrigin(req("http://localhost:3456/x", { "x-forwarded-proto": "https" }))).toBe("https://localhost:3456");
    expect(cimdOrigin(req("http://x/", { "x-forwarded-host": "a.example, b.example" }))).toBe("https://a.example");
  });
});
