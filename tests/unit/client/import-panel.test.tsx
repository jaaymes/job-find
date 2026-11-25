import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportPanel } from "@/components/profile/ImportPanel";
import { defaultAiSettings } from "@/lib/client/ai/settings";
import { AiError } from "@/lib/client/ai/errors";
import type { Profile } from "@/lib/shared/schemas/profile";
import { emptyProfile } from "@/lib/shared/schemas/profile";

const mocks = vi.hoisted(() => ({ extractText: vi.fn(), importProfile: vi.fn() }));
vi.mock("@/lib/client/extract", () => ({ extractText: mocks.extractText }));
vi.mock("@/lib/client/profile/import", () => ({ importProfile: mocks.importProfile }));

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const file = new File([new Uint8Array([1])], "cv.pdf", { type: "application/pdf" });
const fileInput = () => screen.getByLabelText("Arquivo do currículo (PDF ou DOCX)") as HTMLInputElement;

function setup() {
  const onImported = vi.fn();
  render(
    <ImportPanel
      settings={defaultAiSettings()}
      canUseAi
      onImported={onImported}
      onManual={() => {}}
      hasProfile={false}
      lastImport={null}
    />,
  );
  return onImported;
}

beforeEach(() => {
  mocks.extractText.mockReset();
  mocks.importProfile.mockReset();
});
afterEach(cleanup);

describe("ImportPanel: Cancelar", () => {
  it("durante a leitura: volta a idle e o resultado tardio não chama a IA nem importa", async () => {
    const ext = deferred<{ kind: "pdf"; text: string; pages: number; scanned: boolean }>();
    mocks.extractText.mockReturnValue(ext.promise);
    const onImported = setup();

    fireEvent.change(fileInput(), { target: { files: [file] } });
    expect(await screen.findByText("Lendo o arquivo...")).toBeTruthy();
    expect(fileInput().disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(fileInput().disabled).toBe(false);

    await act(async () => {
      ext.resolve({ kind: "pdf", text: "texto", pages: 1, scanned: false });
      await ext.promise;
    });
    expect(mocks.importProfile).not.toHaveBeenCalled();
    expect(onImported).not.toHaveBeenCalled();
    expect(fileInput().disabled).toBe(false);
    expect(screen.queryByText("Lendo o arquivo...")).toBeNull();
  });

  it("durante a análise: importProfile resolve depois do abort e nada é importado", async () => {
    mocks.extractText.mockResolvedValue({ kind: "pdf", text: "texto", pages: 1, scanned: false });
    const imp = deferred<Profile>();
    mocks.importProfile.mockReturnValue(imp.promise);
    const onImported = setup();

    fireEvent.change(fileInput(), { target: { files: [file] } });
    expect(await screen.findByText("Estruturando o currículo com IA...")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(fileInput().disabled).toBe(false);

    await act(async () => {
      imp.resolve(emptyProfile());
      await imp.promise;
    });
    expect(onImported).not.toHaveBeenCalled();
    expect(fileInput().disabled).toBe(false);
    expect(screen.queryByText("Estruturando o currículo com IA...")).toBeNull();
  });
});

const dialog = () => screen.queryByRole("dialog", { name: "Importando seu currículo" });
const percent = () => Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
const okText = { kind: "pdf", text: "texto do cv", pages: 1, scanned: false };

describe("ImportPanel: modal de progresso", () => {
  it("abre o modal com a etapa de leitura", async () => {
    mocks.extractText.mockReturnValue(new Promise(() => {}));
    setup();
    fireEvent.change(fileInput(), { target: { files: [file] } });
    expect(await screen.findByRole("dialog", { name: "Importando seu currículo" })).toBeTruthy();
    expect(screen.getByText("Lendo o arquivo...")).toBeTruthy();
  });

  it("mostra o que a IA encontrou e a porcentagem sobe", async () => {
    mocks.extractText.mockResolvedValue(okText);
    mocks.importProfile.mockImplementation((_t: string, _s: unknown, _sig: unknown, onPartial: (p: unknown) => void) => {
      onPartial({ experiences: [{}, {}, {}], skills: Array(14).fill({}), education: [{}] });
      return new Promise(() => {});
    });
    setup();
    fireEvent.change(fileInput(), { target: { files: [file] } });
    expect(await screen.findByText("Encontrado até agora: 3 experiências · 14 competências · 1 formação")).toBeTruthy();
    await vi.waitFor(() => expect(percent()).toBeGreaterThanOrEqual(30));
  });

  it("a barra avança durante um stream contínuo (parciais a cada 50 ms)", async () => {
    mocks.extractText.mockResolvedValue(okText);
    let streaming = true;
    mocks.importProfile.mockImplementation(async (_t: string, _s: unknown, _sig: unknown, onPartial: (p: unknown) => void) => {
      for (let i = 1; streaming && i <= 40; i++) {
        onPartial({ experiences: Array(i).fill({ company: "x".repeat(20) }) });
        await new Promise((r) => setTimeout(r, 50));
      }
      return new Promise(() => {});
    });
    setup();
    fireEvent.change(fileInput(), { target: { files: [file] } });
    await screen.findByText(/Encontrado até agora/);
    await vi.waitFor(() => expect(percent()).toBeGreaterThanOrEqual(40), { timeout: 1500 });
    streaming = false;
  });

  it("Esc cancela e fecha, e o resultado tardio não importa", async () => {
    mocks.extractText.mockResolvedValue(okText);
    const imp = deferred<Profile>();
    mocks.importProfile.mockReturnValue(imp.promise);
    const onImported = setup();
    fireEvent.change(fileInput(), { target: { files: [file] } });
    const d = await screen.findByRole("dialog", { name: "Importando seu currículo" });
    await screen.findByText("Estruturando o currículo com IA...");
    fireEvent.keyDown(d, { key: "Escape" });
    await vi.waitFor(() => expect(dialog()).toBeNull());
    expect(fileInput().disabled).toBe(false);
    await act(async () => {
      imp.resolve(emptyProfile());
      await imp.promise;
    });
    expect(onImported).not.toHaveBeenCalled();
  });

  it("sucesso fecha o modal antes do onImported", async () => {
    mocks.extractText.mockResolvedValue(okText);
    mocks.importProfile.mockResolvedValue(emptyProfile());
    let openAtImport: boolean | null = null;
    render(
      <ImportPanel
        settings={defaultAiSettings()}
        canUseAi
        onImported={() => {
          openAtImport = screen.queryByRole("progressbar") !== null;
        }}
        onManual={() => {}}
        hasProfile={false}
        lastImport={null}
      />,
    );
    fireEvent.change(fileInput(), { target: { files: [file] } });
    await vi.waitFor(() => expect(openAtImport).not.toBeNull());
    expect(openAtImport).toBe(false);
  });

  it("erro fecha o modal e mostra o alerta no card", async () => {
    mocks.extractText.mockResolvedValue(okText);
    mocks.importProfile.mockRejectedValue(new AiError("unavailable", { retryable: true }));
    setup();
    fireEvent.change(fileInput(), { target: { files: [file] } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Tentar de novo");
    await vi.waitFor(() => expect(dialog()).toBeNull());
  });

  it("Tentar de novo recomeça do zero", async () => {
    mocks.extractText.mockResolvedValueOnce(okText).mockReturnValueOnce(new Promise(() => {}));
    mocks.importProfile.mockImplementation(async (_t: string, _s: unknown, _sig: unknown, onPartial: (p: unknown) => void) => {
      onPartial({ experiences: Array(50).fill({ bullets: ["x".repeat(400)] }) });
      await new Promise((r) => setTimeout(r, 300));
      throw new AiError("unavailable", { retryable: true });
    });
    setup();
    fireEvent.change(fileInput(), { target: { files: [file] } });
    await vi.waitFor(() => expect(percent()).toBeGreaterThan(30));
    fireEvent.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    await screen.findByRole("dialog", { name: "Importando seu currículo" });
    expect(percent()).toBeLessThan(15);
  });

  it("PDF escaneado fecha o modal e abre o campo de colar", async () => {
    mocks.extractText.mockResolvedValue({ kind: "pdf", text: "", pages: 1, scanned: true });
    setup();
    fireEvent.change(fileInput(), { target: { files: [file] } });
    const box = await screen.findByLabelText("Texto do currículo");
    await vi.waitFor(() => expect(document.activeElement).toBe(box));
    expect(dialog()).toBeNull();
  });
});

describe("ImportPanel: textos por tipo de ponteiro", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("com ponteiro de toque o texto é Toque para escolher o PDF ou DOCX", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(pointer: coarse)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    setup();
    expect(screen.getByText("Toque para escolher o PDF ou DOCX")).toBeTruthy();
    expect(screen.queryByText("Arraste o arquivo ou clique para escolher")).toBeNull();
  });

  it("com mouse mantém o texto de arrastar", () => {
    setup();
    expect(screen.getByText("Arraste o arquivo ou clique para escolher")).toBeTruthy();
  });
});
