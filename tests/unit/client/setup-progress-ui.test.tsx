import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReturnToJobLink, SetupProgress } from "@/components/onboarding/SetupProgress";
import { aiSettingsStore, defaultAiSettings } from "@/lib/client/ai/settings";
import { profileStore } from "@/lib/client/profile/store";
import { emptyProfile } from "@/lib/shared/schemas/profile";
import { resetStorageProbeForTests } from "@/lib/client/storage/store";

const AI = {
  ...defaultAiSettings(),
  providers: { openrouter: { key: "k", addedAt: "2026-01-01", source: "paste" as const } },
};

describe("SetupProgress", () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageProbeForTests();
  });
  afterEach(() => cleanup());

  it("banner no passo 2 mostra título, contador e link com retorno", () => {
    aiSettingsStore.set(AI);
    render(<SetupProgress variant="banner" returnTo="/vagas/4059" />);
    expect(screen.getByText("Veja sua chance em cada vaga")).toBeTruthy();
    expect(screen.getByText("2/3")).toBeTruthy();
    expect(screen.getByText(/IA conectada\. Falta importar seu currículo/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Importar currículo" }).getAttribute("href")).toBe(
      "/perfil?voltar=%2Fvagas%2F4059",
    );
  });

  it("no passo 1 convida a conectar a IA", () => {
    render(<SetupProgress variant="card" />);
    expect(screen.getByText("1/3")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Conectar IA" }).getAttribute("href")).toBe("/configuracoes");
  });

  it("não renderiza nada quando tudo está pronto", () => {
    aiSettingsStore.set(AI);
    profileStore.set(emptyProfile());
    const { container } = render(<SetupProgress variant="banner" />);
    expect(container.textContent).toBe("");
  });
});

describe("ReturnToJobLink", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
  });

  it("aparece com ?voltar válido e aponta para a vaga", () => {
    window.history.replaceState(null, "", "/perfil?voltar=%2Fvagas%2F4059");
    render(<ReturnToJobLink />);
    expect(screen.getByRole("link", { name: "Voltar para a vaga" }).getAttribute("href")).toBe("/vagas/4059");
  });

  it("não aparece com ?voltar inválido", () => {
    window.history.replaceState(null, "", "/perfil?voltar=%2F%2Fevil.com");
    const { container } = render(<ReturnToJobLink />);
    expect(container.textContent).toBe("");
  });
});
