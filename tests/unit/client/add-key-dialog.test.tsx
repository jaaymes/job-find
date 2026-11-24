import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddKeyDialog } from "@/components/settings/AddKeyDialog";
import { AiError } from "@/lib/client/ai/errors";
import { PROVIDERS } from "@/lib/client/ai/providers";

const testConnection = vi.fn();
const toast = vi.fn();
vi.mock("@/lib/client/ai/test-connection", () => ({ testConnection: (...a: unknown[]) => testConnection(...a) }));
vi.mock("sonner", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const KEY = "sk-proj-segredo1234";

beforeEach(() => {
  testConnection.mockReset();
  toast.mockReset();
});
afterEach(cleanup);

function setup(id: "openai" | "anthropic" | "local" = "openai") {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(<AddKeyDialog provider={PROVIDERS[id]} onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
}

function paste(value: string) {
  fireEvent.change(screen.getByLabelText("Chave de API"), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Testar e salvar" }));
}

describe("AddKeyDialog", () => {
  it("chave recusada (401) mantém o diálogo, mostra o erro e devolve o foco ao campo", async () => {
    testConnection.mockRejectedValue(new AiError("invalid_key"));
    const { onSave } = setup();
    paste(KEY);
    submit();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("O provedor recusou essa chave.");
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Chave de API"));
    expect(testConnection).toHaveBeenCalledWith(PROVIDERS.openai, { apiKey: KEY });
    expect(document.body.textContent).not.toContain(KEY);
  });

  it("erro de rede salva a chave e avisa que não deu para testar", async () => {
    testConnection.mockRejectedValue(new AiError("unavailable", { retryable: true }));
    const { onSave } = setup();
    paste(`  ${KEY} `);
    submit();

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ key: KEY }));
    expect(toast).toHaveBeenCalledWith("Chave salva, mas não deu para testar agora.");
    expect(JSON.stringify(toast.mock.calls)).not.toContain(KEY);
  });

  it("limite de uso (429) também salva com o aviso", async () => {
    testConnection.mockRejectedValue(new AiError("rate_limit", { retryable: true }));
    const { onSave } = setup();
    paste(KEY);
    submit();
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(toast).toHaveBeenCalledWith("Chave salva, mas não deu para testar agora.");
  });

  it("chave aceita salva sem aviso", async () => {
    testConnection.mockResolvedValue(undefined);
    const { onSave } = setup();
    paste(KEY);
    submit();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ key: KEY }));
    expect(toast).not.toHaveBeenCalled();
  });

  it("chave da Anthropic colada na OpenAI avisa enquanto digita, sem bloquear o botão", () => {
    setup();
    paste("sk-ant-x");
    const hint = screen.getByText("Parece uma chave do(a) Anthropic (Claude).");
    expect(hint.closest("[aria-live='polite']")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Testar e salvar" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("mostra os passos para criar a chave quando o provedor tem keySteps", () => {
    setup("anthropic");
    for (const step of PROVIDERS.anthropic.keySteps ?? []) expect(screen.getByText(step)).toBeTruthy();
  });

  it("campo vazio não chama o teste", () => {
    const { onSave } = setup();
    submit();
    expect(screen.getByRole("alert").textContent).toBe("Cole a chave de API.");
    expect(testConnection).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("IA local salva o endereço sem testar", () => {
    const { onSave } = setup("local");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onSave).toHaveBeenCalledWith({ baseURL: PROVIDERS.local.baseURL });
    expect(testConnection).not.toHaveBeenCalled();
  });
});
