import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileEditor } from "@/components/profile/ProfileEditor";
import type { AssistTarget, Draft } from "@/lib/client/ai/prompts/profile.assist.v1";
import { emptyProfile, type Profile } from "@/lib/shared/schemas/profile";

const mocks = vi.hoisted(() => ({ toast: vi.fn(), insert: null as null | Draft, targets: [] as AssistTarget[] }));
vi.mock("sonner", () => ({ toast: mocks.toast }));
// O painel é mockado: o botão "Inserir (mock)" chama `onInsert` direto, como o painel real faz antes de fechar.
vi.mock("@/components/profile/assistant/AssistantDialog", () => ({
  AssistantDialog: ({ open, target, onInsert, onOpenChange }: {
    open: boolean;
    target: AssistTarget;
    onInsert: (d: Draft) => void;
    onOpenChange: (o: boolean) => void;
  }) => {
    if (open) mocks.targets.push(target);
    return open ? (
      <button
        type="button"
        onClick={() => {
          onInsert(mocks.insert!);
          onOpenChange(false);
        }}
      >
        Inserir (mock)
      </button>
    ) : null;
  },
}));

function profile(over: Partial<Profile> = {}): Profile {
  return {
    ...emptyProfile(),
    experiences: [
      {
        id: "exp_1",
        company: "Acme",
        title: "Dev",
        startDate: null,
        endDate: null,
        bullets: [
          { id: "exp_1.b1", text: "Fiz A" },
          { id: "exp_1.b2", text: "Fiz B" },
        ],
      },
    ],
    highlights: ["exp_1.b1"],
    ...over,
  };
}

const undo = () => {
  const opts = mocks.toast.mock.calls.at(-1)![1] as { action: { label: string; onClick: () => void } };
  expect(opts.action.label).toBe("Desfazer");
  act(() => opts.action.onClick());
};
const summary = () => screen.getByLabelText("Resumo") as HTMLTextAreaElement;
const beforeUnloadBlocked = () => {
  const ev = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
};

beforeEach(() => {
  mocks.toast.mockReset();
  mocks.targets.length = 0;
});
afterEach(cleanup);

describe("botões do assistente no editor", () => {
  it("rótulos mudam entre vazio e preenchido (título, resumo e bullets)", () => {
    const { unmount } = render(<ProfileEditor profile={profile()} onSave={() => true} />);
    expect(screen.getAllByRole("button", { name: /^Escrever com IA/ })).toHaveLength(2);
    unmount();
    render(
      <ProfileEditor profile={profile({ headline: "Dev", summary: "Resumo" })} onSave={() => true} />,
    );
    expect(screen.getAllByRole("button", { name: /^Melhorar com IA/ })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /^Escrever com IA/ })).toBeNull();
  });

  it("bullets: a experiência fechada já tem o botão; 'Melhorar' com bullets e 'Escrever' sem eles", () => {
    render(<ProfileEditor profile={profile({ headline: "x", summary: "y" })} onSave={() => true} />);
    expect(screen.getAllByRole("button", { name: /^Melhorar com IA/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /Editar experiência/ }));
    expect(screen.getAllByRole("button", { name: /^Melhorar com IA/ })).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Remover realização 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Remover realização 1" }));
    expect(screen.getAllByRole("button", { name: /^Escrever com IA/ })).toHaveLength(1);
  });
});

describe("inserir e desfazer", () => {
  it("resumo: altera o rascunho, avisa com Desfazer, não grava no localStorage e marca alterações não salvas", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(<ProfileEditor profile={profile({ headline: "x", summary: "Antigo" })} onSave={() => true} />);
    expect(beforeUnloadBlocked()).toBe(false);
    mocks.insert = { text: "Novo resumo", bullets: null };
    fireEvent.click(screen.getAllByRole("button", { name: /^Melhorar com IA/ })[1]);
    expect(mocks.targets.at(-1)).toEqual({ kind: "summary" });
    fireEvent.click(screen.getByRole("button", { name: "Inserir (mock)" }));
    expect(summary().value).toBe("Novo resumo");
    expect(mocks.toast.mock.calls.at(-1)![0]).toBe("Texto inserido");
    expect((mocks.toast.mock.calls.at(-1)![1] as { duration: number }).duration).toBe(8000);
    expect(setItem).not.toHaveBeenCalled();
    expect(beforeUnloadBlocked()).toBe(true);
    undo();
    expect(summary().value).toBe("Antigo");
    setItem.mockRestore();
  });

  it("título: insere e desfaz", () => {
    render(<ProfileEditor profile={profile()} onSave={() => true} />);
    mocks.insert = { text: "Engenheira de Software", bullets: null };
    fireEvent.click(screen.getAllByRole("button", { name: /^Escrever com IA/ })[0]);
    expect(mocks.targets.at(-1)).toEqual({ kind: "headline" });
    fireEvent.click(screen.getByRole("button", { name: "Inserir (mock)" }));
    const input = screen.getByLabelText("Título profissional") as HTMLInputElement;
    expect(input.value).toBe("Engenheira de Software");
    undo();
    expect(input.value).toBe("");
  });

  it("bullets: substitui com ids novos, tira o destaque antigo e o Desfazer restaura tudo", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(<ProfileEditor profile={profile({ headline: "x", summary: "y" })} onSave={() => true} />);
    fireEvent.click(screen.getByRole("button", { name: /Editar experiência/ }));
    mocks.insert = { text: null, bullets: ["Novo 1", "Novo 2"] };
    fireEvent.click(screen.getAllByRole("button", { name: /^Melhorar com IA/ })[2]);
    expect(mocks.targets.at(-1)).toEqual({ kind: "bullets", expId: "exp_1" });
    fireEvent.click(screen.getByRole("button", { name: "Inserir (mock)" }));

    expect((screen.getByLabelText("Realização 1") as HTMLTextAreaElement).value).toBe("Novo 1");
    expect((screen.getByLabelText("Realização 2") as HTMLTextAreaElement).value).toBe("Novo 2");
    // `exp_1.b1` e `exp_1.b2` já existiam: os novos ids seguem em frente e o destaque antigo some.
    expect(screen.queryByRole("button", { name: "Destacar no CV", pressed: true })).toBeNull();
    expect(setItem).not.toHaveBeenCalled();

    // Um novo bullet manual não reaproveita os ids emitidos pelo assistente.
    fireEvent.click(screen.getByRole("button", { name: "+ Realização" }));
    expect(screen.getAllByLabelText(/^Realização \d$/)).toHaveLength(3);

    undo();
    expect((screen.getByLabelText("Realização 1") as HTMLTextAreaElement).value).toBe("Fiz A");
    expect((screen.getByLabelText("Realização 2") as HTMLTextAreaElement).value).toBe("Fiz B");
    expect(screen.queryByLabelText("Realização 3")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Destacar no CV", pressed: true })).toHaveLength(1);
    setItem.mockRestore();
  });

  it("bullets: ids novos não reaproveitam os existentes nem os removidos", () => {
    const onSave = vi.fn(() => true);
    render(<ProfileEditor profile={profile({ headline: "x", summary: "y" })} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /Editar experiência/ }));
    mocks.insert = { text: null, bullets: ["N1", "N2"] };
    fireEvent.click(screen.getAllByRole("button", { name: /^Melhorar com IA/ })[2]);
    fireEvent.click(screen.getByRole("button", { name: "Inserir (mock)" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    const saved = (onSave.mock.calls[0] as unknown as [Profile])[0];
    expect(saved.experiences[0].bullets.map((b) => b.id)).toEqual(["exp_1.b3", "exp_1.b4"]);
    expect(saved.highlights).toEqual([]);
  });
});

describe("desfazer e limite de destaques", () => {
  it("o Desfazer nunca deixa mais de 3 destaques", () => {
    const onSave = vi.fn(() => true);
    const base = profile({ headline: "x", summary: "y" });
    const exp2 = {
      id: "exp_2",
      company: "Beta",
      title: "Dev2",
      startDate: null,
      endDate: null,
      bullets: [
        { id: "exp_2.b1", text: "C1" },
        { id: "exp_2.b2", text: "C2" },
        { id: "exp_2.b3", text: "C3" },
      ],
    };
    // 1 destaque fora de exp_1 e 2 dentro dela.
    render(
      <ProfileEditor
        profile={{ ...base, experiences: [...base.experiences, exp2], highlights: ["exp_2.b1", "exp_1.b1", "exp_1.b2"] }}
        onSave={onSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Editar experiência\s*Dev · Acme/ }));
    mocks.insert = { text: null, bullets: ["Novo 1", "Novo 2"] };
    fireEvent.click(screen.getAllByRole("button", { name: /^Melhorar com IA/ })[2]);
    fireEvent.click(screen.getByRole("button", { name: "Inserir (mock)" }));
    // Libera 2 vagas e as ocupa com bullets de exp_2.
    fireEvent.click(screen.getByRole("button", { name: /Editar experiência\s*Dev2/ }));
    const stars = screen.getAllByRole("button", { name: "Destacar no CV" });
    fireEvent.click(stars[3]);
    fireEvent.click(stars[4]);
    undo();
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    const saved = (onSave.mock.calls[0] as unknown as [Profile])[0];
    expect(saved.highlights.length).toBeLessThanOrEqual(3);
  });

  it("depois de remover o último bullet, o assistente não reaproveita o id", () => {
    const onSave = vi.fn(() => true);
    const base = profile({ headline: "x", summary: "y", highlights: [] });
    const exp = base.experiences[0];
    const withFour = {
      ...base,
      experiences: [
        {
          ...exp,
          bullets: [...exp.bullets, { id: "exp_1.b3", text: "Fiz C" }, { id: "exp_1.b4", text: "Fiz D" }],
        },
      ],
    };
    render(<ProfileEditor profile={withFour} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: /Editar experiência/ }));
    fireEvent.click(screen.getByRole("button", { name: "Remover realização 4" }));
    mocks.insert = { text: null, bullets: ["N1", "N2", "N3", "N4"] };
    fireEvent.click(screen.getAllByRole("button", { name: /^Melhorar com IA/ })[2]);
    fireEvent.click(screen.getByRole("button", { name: "Inserir (mock)" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    const saved = (onSave.mock.calls[0] as unknown as [Profile])[0];
    const ids = saved.experiences[0].bullets.map((b) => b.id);
    expect(ids).not.toContain("exp_1.b4");
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("alterações não salvas calculadas do rascunho", () => {
  const headline = () => screen.getByLabelText("Título profissional") as HTMLInputElement;

  it("digitar e voltar ao valor salvo deixa de avisar", () => {
    render(<ProfileEditor profile={profile({ headline: "Dev" })} onSave={() => true} />);
    expect(beforeUnloadBlocked()).toBe(false);
    fireEvent.change(headline(), { target: { value: "Dev Sênior" } });
    expect(beforeUnloadBlocked()).toBe(true);
    fireEvent.change(headline(), { target: { value: "Dev" } });
    expect(beforeUnloadBlocked()).toBe(false);
  });

  it("editar e salvar deixa de avisar; editar de novo volta a avisar", () => {
    render(<ProfileEditor profile={profile({ headline: "Dev" })} onSave={() => true} />);
    fireEvent.change(headline(), { target: { value: "Outro" } });
    expect(beforeUnloadBlocked()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    expect(beforeUnloadBlocked()).toBe(false);
    fireEvent.change(headline(), { target: { value: "Dev" } });
    expect(beforeUnloadBlocked()).toBe(true);
  });

  it("se a gravação falhar, continua avisando", () => {
    render(<ProfileEditor profile={profile({ headline: "Dev" })} onSave={() => false} />);
    fireEvent.change(headline(), { target: { value: "Outro" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    expect(beforeUnloadBlocked()).toBe(true);
  });
});
