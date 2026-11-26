import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileScreen } from "@/components/profile/ProfileScreen";
import { aiSettingsStore, defaultAiSettings } from "@/lib/client/ai/settings";
import { profileStore } from "@/lib/client/profile/store";
import { emptyProfile } from "@/lib/shared/schemas/profile";

const mocks = vi.hoisted(() => ({ cvs: [] as { lang: string; name: string }[] }));
vi.mock("@/components/generator/TemplatePicker", () => ({
  TemplatePicker: ({ cv }: { cv: { lang: string; name: string } }) => {
    mocks.cvs.push(cv);
    return <div data-testid="picker" data-lang={cv.lang} />;
  },
}));

beforeEach(() => {
  window.localStorage.clear();
  mocks.cvs.length = 0;
  aiSettingsStore.set(defaultAiSettings());
  profileStore.set({ ...emptyProfile(), name: "Ana" });
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("ProfileScreen: card Modelos de CV", () => {
  it("o card Modelos de CV vem depois do Importar currículo, na mesma coluna", () => {
    render(<ProfileScreen />);
    const importH = screen.getByRole("heading", { name: /Importar currículo/ });
    const modelsH = screen.getByRole("heading", { level: 2, name: "Modelos de CV" });
    const editorBtn = screen.getByRole("button", { name: "Salvar perfil" });
    expect(importH.compareDocumentPosition(modelsH) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(modelsH.compareDocumentPosition(editorBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Mesma coluna: o ancestral comum mais próximo do import e do card não contém o editor.
    const column = importH.closest("div.lg\\:max-w-\\[420px\\]");
    expect(column?.contains(modelsH)).toBe(true);
    expect(column?.contains(editorBtn)).toBe(false);
  });

  it("a prévia usa o perfil salvo e o idioma escolhido", () => {
    render(<ProfileScreen />);
    expect(screen.getByTestId("picker").dataset.lang).toBe("pt");
    fireEvent.change(screen.getByLabelText("Idioma dos rótulos do CV"), { target: { value: "en" } });
    const last = mocks.cvs.at(-1)!;
    expect(last.lang).toBe("en");
    expect(last.name).toBe("Ana");
  });

  it("sem perfil salvo o card não aparece", () => {
    window.localStorage.clear();
    aiSettingsStore.set(defaultAiSettings());
    render(<ProfileScreen />);
    expect(screen.queryByRole("heading", { name: "Modelos de CV" })).toBeNull();
  });
});
