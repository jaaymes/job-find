import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportPanel } from "@/components/profile/ImportPanel";
import { defaultAiSettings } from "@/lib/client/ai/settings";
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
