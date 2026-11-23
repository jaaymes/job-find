import { expect, test } from "@playwright/test";

function scriptSrc(csp: string): string {
  const found = csp.split("; ").find((d) => d.startsWith("script-src "));
  if (!found) throw new Error("script-src ausente");
  return found;
}

test.describe("CSP com nonce nas rotas (local) (D-15)", () => {
  test("/perfil tem um único header CSP com nonce, sem unsafe-inline, e hidrata sem violações", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (msg) => {
      if (/content security policy|refused to (load|apply|execute|connect)/i.test(msg.text())) {
        problems.push(msg.text());
      }
    });
    page.on("pageerror", (err) => problems.push(err.message));
    await page.addInitScript(() => {
      (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) => {
        (window as unknown as { __cspViolations: string[] }).__cspViolations.push(
          `${e.violatedDirective} ${e.blockedURI}`,
        );
      });
    });

    const response = await page.goto("/perfil");
    expect(response?.status()).toBe(200);
    const csps = (await response!.headersArray()).filter((h) => h.name.toLowerCase() === "content-security-policy");
    expect(csps).toHaveLength(1);
    const script = scriptSrc(csps[0].value);
    expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");

    await expect(page.getByRole("heading", { name: "Seu perfil" })).toBeVisible();
    // Hidratou: o React anexou suas props de evento/fibras aos nós do DOM.
    await page.waitForFunction(() =>
      Object.keys(document.body.firstElementChild ?? {}).some((k) => k.startsWith("__reactFiber")),
    );
    expect(await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("o nonce muda a cada requisição e os scripts inline levam o nonce", async ({ page, request }) => {
    const nonceOf = async () => {
      const res = await request.get("/perfil");
      return /'nonce-([^']+)'/.exec(res.headers()["content-security-policy"])?.[1];
    };
    const a = await nonceOf();
    const b = await nonceOf();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);

    const response = await page.goto("/perfil");
    const nonce = /'nonce-([^']+)'/.exec(response!.headers()["content-security-policy"])?.[1];
    const inline = await page.evaluate(() =>
      [...document.scripts].filter((s) => !s.src).map((s) => s.nonce || s.getAttribute("nonce")),
    );
    expect(inline.length).toBeGreaterThan(0);
    for (const n of inline) expect(n).toBe(nonce);
  });

  test("subcaminhos (local), mesmo 404, respondem com um único header CSP com nonce", async ({ request }) => {
    for (const path of ["/perfil/x", "/configuracoes/callback", "/gerador/abc", "/minhas-vagas/x"]) {
      const res = await request.get(path);
      const csps = res.headersArray().filter((h) => h.name.toLowerCase() === "content-security-policy");
      expect(csps, path).toHaveLength(1);
      expect(csps[0].value, path).toContain("nonce-");
    }
  });

  test("respostas (local) não são cacheáveis publicamente", async ({ request }) => {
    const cache = (await request.get("/perfil")).headers()["cache-control"] ?? "";
    console.log(`cache-control /perfil: ${cache}`);
    expect(cache).not.toMatch(/public|s-maxage/);
  });

  test("a home continua com a CSP estática (um único header) e os demais headers de segurança", async ({ request }) => {
    for (const path of ["/", "/perfil"]) {
      const res = await request.get(path);
      expect(res.headers()["x-frame-options"]).toBe("DENY");
      expect(res.headers()["strict-transport-security"]).toContain("max-age=");
    }
    const res = await request.get("/");
    const csps = res.headersArray().filter((h) => h.name.toLowerCase() === "content-security-policy");
    expect(csps).toHaveLength(1);
    expect(scriptSrc(csps[0].value)).toContain("'unsafe-inline'");
    expect(csps[0].value).not.toContain("nonce-");
  });
});
