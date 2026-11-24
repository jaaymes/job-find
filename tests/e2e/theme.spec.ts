import { expect, test, type Page } from "@playwright/test";
import { THEME_SCRIPT } from "@/lib/shared/theme-script";

type Probe = { cspViolations: string[]; darkAtDomContentLoaded: boolean | null; firstClass: string | null };

/** Coleta violações de CSP (como no csp-local.spec.ts) e anota o tema no primeiro momento observável. */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __probe: Probe };
    w.__probe = { cspViolations: [], darkAtDomContentLoaded: null, firstClass: null };
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__probe.cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
    // Antes do primeiro <body> existir o <head> já rodou o THEME_SCRIPT: guarda a classe nesse instante.
    const observer = new MutationObserver(() => {
      if (document.body && w.__probe.firstClass === null) {
        w.__probe.firstClass = document.documentElement.className;
        observer.disconnect();
      }
    });
    observer.observe(document, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", () => {
      w.__probe.darkAtDomContentLoaded = document.documentElement.classList.contains("dark");
    });
  });
}

const probe = (page: Page) => page.evaluate(() => (window as unknown as { __probe: Probe }).__probe);

test.describe("tema claro/escuro", () => {
  test("alternar o tema na home persiste ao ir para /perfil, sem flash e sem violação de CSP", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (msg) => {
      if (/content security policy|refused to (load|apply|execute|connect)/i.test(msg.text())) {
        problems.push(msg.text());
      }
    });
    page.on("pageerror", (err) => problems.push(err.message));
    await instrument(page);

    await page.goto("/");
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
    const toggle = page.getByRole("button", { name: "Ativar tema escuro" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
    await expect(page.getByRole("button", { name: "Ativar tema claro" })).toHaveAttribute("aria-pressed", "true");
    expect((await probe(page)).cspViolations).toEqual([]);

    await page.goto("/perfil");
    await expect(page.getByRole("heading", { name: "Seu perfil" })).toBeVisible();
    const p = await probe(page);
    expect(p.firstClass).toMatch(/(^|\s)dark(\s|$)/);
    expect(p.darkAtDomContentLoaded).toBe(true);
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe("dark");
    // O THEME_SCRIPT sai uma vez só, no <head>, byte a byte igual ao exportado (senão o hash da CSP não bate).
    // (O payload RSC também cita o texto, mas como dado dentro de self.__next_f.push, não como script.)
    const themeScripts = await page.evaluate(
      (src) => [...document.scripts].filter((s) => !s.src && s.textContent === src).map((s) => s.parentElement?.tagName),
      THEME_SCRIPT,
    );
    expect(themeScripts).toEqual(["HEAD"]);
    expect(p.cspViolations).toEqual([]);
    expect(problems).toEqual([]);
  });

  test("primeira visita segue o sistema", async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await instrument(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/);
    expect((await probe(page)).darkAtDomContentLoaded).toBe(true);
    await expect(page.getByRole("button", { name: "Ativar tema claro" })).toHaveAttribute("aria-pressed", "true");
    await context.close();
  });
});
