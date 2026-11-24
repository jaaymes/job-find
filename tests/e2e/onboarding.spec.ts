import { expect, test } from "@playwright/test";

// Primeira visita de verdade: sem o estado "guia já visto" da configuração global.
test.use({ storageState: { cookies: [], origins: [] } });

test("primeira visita mostra o guia; depois de pular, não aparece mais", async ({ page }) => {
  await page.goto("/");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Bem-vindo ao Job Find");
  await expect(dialog).toContainText("localStorage");
  await dialog.getByRole("button", { name: "Próximo" }).click();
  await expect(dialog.getByRole("link", { name: "Conectar IA" })).toHaveAttribute("href", "/configuracoes");
  await dialog.getByRole("button", { name: "Próximo" }).click();
  await expect(dialog).toContainText("LinkedIn");
  await dialog.getByRole("button", { name: "Concluir" }).click();
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(page.getByRole("button", { name: "Guia de início" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
