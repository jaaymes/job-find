import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantDialog } from "@/components/profile/assistant/AssistantDialog";
import { AiError } from "@/lib/client/ai/errors";
import type { AssistTarget, Draft } from "@/lib/client/ai/prompts/profile.assist.v1";
import { emptyProfile } from "@/lib/shared/schemas/profile";

const mocks = vi.hoisted(() => ({ askQuestions: vi.fn(), writeDrafts: vi.fn(), rewriteDraft: vi.fn(), usable: vi.fn() }));
vi.mock("@/lib/client/profile/assist", () => ({
  askQuestions: mocks.askQuestions,
  writeDrafts: mocks.writeDrafts,
  rewriteDraft: mocks.rewriteDraft,
  ASSIST_INVENTED_MESSAGE: "A IA sugeriu fatos que não estão no seu perfil. Tente de novo ou responda com mais detalhes.",
}));
vi.mock("@/lib/client/ai/model", () => ({ hasUsableProvider: mocks.usable }));

const INVENTED = "A IA sugeriu fatos que não estão no seu perfil. Tente de novo ou responda com mais detalhes.";
const EMPTY: Draft = { text: "", bullets: null };
const QUESTIONS = ["Qual foi seu maior projeto?", "Que tecnologias usou?", "Que resultado alcançou?"];

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function setup(over: { target?: AssistTarget; current?: Draft } = {}) {
  const onInsert = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <AssistantDialog
      open
      onOpenChange={onOpenChange}
      profile={emptyProfile()}
      target={over.target ?? { kind: "summary" }}
      current={over.current ?? EMPTY}
      onInsert={onInsert}
    />,
  );
  return { onInsert, onOpenChange };
}

beforeEach(() => {
  mocks.askQuestions.mockReset().mockResolvedValue(QUESTIONS);
  mocks.writeDrafts.mockReset();
  mocks.rewriteDraft.mockReset();
  mocks.usable.mockReset().mockReturnValue(true);
});
afterEach(cleanup);

describe("AssistantDialog: sem provedor", () => {
  it("avisa e linka para /configuracoes, sem chamar a IA", async () => {
    mocks.usable.mockReturnValue(false);
    setup();
    expect(await screen.findByText("Conecte uma IA para usar o assistente")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Conecte uma IA/ }).getAttribute("href")).toBe("/configuracoes");
    expect(mocks.askQuestions).not.toHaveBeenCalled();
  });
});

describe("AssistantDialog: entrevista", () => {
  const drafts: [Draft, Draft] = [
    { text: "Opção um", bullets: ["ignorado"] },
    { text: "Opção dois", bullets: null },
  ];

  it("mostra 3 perguntas, manda as puladas como string vazia e insere o texto editado", async () => {
    mocks.writeDrafts.mockResolvedValue(drafts);
    const { onInsert, onOpenChange } = setup();
    const boxes = await screen.findAllByRole("textbox");
    expect(boxes).toHaveLength(3);
    expect(screen.getByLabelText(QUESTIONS[0])).toBe(boxes[0]);
    fireEvent.change(boxes[0], { target: { value: "Fiz um app" } });
    fireEvent.click(screen.getByRole("button", { name: "Gerar" }));

    await screen.findByRole("radiogroup");
    expect(mocks.writeDrafts).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { kind: "summary" },
        qa: [
          { question: QUESTIONS[0], answer: "Fiz um app" },
          { question: QUESTIONS[1], answer: "" },
          { question: QUESTIONS[2], answer: "" },
        ],
      }),
    );
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("radio")[1]);
    const area = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(area.value).toBe("Opção dois");
    fireEvent.change(area, { target: { value: "Opção dois editada" } });
    fireEvent.click(screen.getByRole("button", { name: "Inserir no perfil" }));
    expect(onInsert).toHaveBeenCalledWith({ text: "Opção dois editada", bullets: null });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("bullets: uma textarea por bullet e Remover tira um", async () => {
    mocks.writeDrafts.mockResolvedValue([
      { text: null, bullets: ["Reduzi custos", "Liderei a equipe"] },
      { text: null, bullets: ["Outro"] },
    ]);
    const { onInsert } = setup({ target: { kind: "bullets", expId: "exp_1" } });
    fireEvent.click(await screen.findByRole("button", { name: "Gerar" }));
    await screen.findByRole("radiogroup");
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remover realização 1" }));
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Inserir no perfil" }));
    expect(onInsert).toHaveBeenCalledWith({ text: null, bullets: ["Liderei a equipe"] });
  });

  it("Cancelar durante a geração aborta o signal, volta às respostas, sem erro e sem inserir", async () => {
    const pending = deferred<[Draft, Draft]>();
    mocks.writeDrafts.mockReturnValue(pending.promise);
    const { onInsert } = setup();
    fireEvent.change((await screen.findAllByRole("textbox"))[0], { target: { value: "resposta" } });
    fireEvent.click(screen.getByRole("button", { name: "Gerar" }));
    const signal = (await waitFor(() => {
      expect(mocks.writeDrafts).toHaveBeenCalled();
      return mocks.writeDrafts.mock.calls[0][0];
    })).signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(signal.aborted).toBe(true);
    await act(async () => {
      pending.resolve(drafts);
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect((screen.getAllByRole("textbox")[0] as HTMLTextAreaElement).value).toBe("resposta");
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("invalid_output mostra a mensagem da D-04 e Tentar de novo refaz a geração", async () => {
    mocks.writeDrafts.mockRejectedValueOnce(new AiError("invalid_output")).mockResolvedValueOnce(drafts);
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Gerar" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(INVENTED);
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    await screen.findByRole("radiogroup");
    expect(mocks.writeDrafts).toHaveBeenCalledTimes(2);
  });

  it("região aria-live=polite mostra o texto parcial do onPartial", async () => {
    const pending = deferred<[Draft, Draft]>();
    mocks.writeDrafts.mockImplementation((a: { onPartial: (p: unknown) => void }) => {
      a.onPartial({ options: [{ text: "Texto parcial em andamento", bullets: null }] });
      return pending.promise;
    });
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Gerar" }));
    await waitFor(() => {
      const live = document.querySelector('[aria-live="polite"]');
      expect(live?.textContent).toContain("Texto parcial em andamento");
    });
  });
});

describe("AssistantDialog: reescrita", () => {
  const current: Draft = { text: "Texto antigo", bullets: null };

  it("mostra Texto atual e Sugestão; Traduzir abre o idioma e Gerar de novo usa translate/en", async () => {
    mocks.rewriteDraft.mockResolvedValue({ text: "Texto novo", bullets: null });
    setup({ current });
    expect(await screen.findByText("Texto atual")).toBeTruthy();
    expect(screen.getByText("Sugestão")).toBeTruthy();
    expect(screen.getByText("Texto antigo")).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText("Sugestão editável") as HTMLTextAreaElement).value).toBe("Texto novo"));
    expect(mocks.rewriteDraft).toHaveBeenLastCalledWith(expect.objectContaining({ tone: { tone: "default" }, current }));

    expect(screen.queryByLabelText("Idioma")).toBeNull();
    fireEvent.change(screen.getByLabelText("Tom"), { target: { value: "translate" } });
    expect(screen.getByLabelText("Idioma")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Gerar de novo" }));
    await waitFor(() =>
      expect(mocks.rewriteDraft).toHaveBeenLastCalledWith(expect.objectContaining({ tone: { tone: "translate", lang: "en" } })),
    );
  });

  it("insere a sugestão editada", async () => {
    mocks.rewriteDraft.mockResolvedValue({ text: "Texto novo", bullets: null });
    const { onInsert } = setup({ current });
    const area = await screen.findByLabelText("Sugestão editável");
    fireEvent.change(area, { target: { value: "  Texto final  " } });
    fireEvent.click(screen.getByRole("button", { name: "Inserir no perfil" }));
    expect(onInsert).toHaveBeenCalledWith({ text: "Texto final", bullets: null });
  });
});
