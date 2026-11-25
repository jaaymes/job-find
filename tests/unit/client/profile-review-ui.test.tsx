import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileEditor } from "@/components/profile/ProfileEditor";
import type { AssistTarget, Draft } from "@/lib/client/ai/prompts/profile.assist.v1";
import { emptyProfile, type Profile } from "@/lib/shared/schemas/profile";

const mocks = vi.hoisted(() => ({ opened: [] as { target: AssistTarget; current: Draft }[] }));
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("@/components/profile/assistant/AssistantDialog", () => ({
  AssistantDialog: ({ open, target, current }: { open: boolean; target: AssistTarget; current: Draft }) => {
    if (open) mocks.opened.push({ target, current });
    return open ? <div role="dialog">Painel do assistente</div> : null;
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
          { id: "exp_1.b1", text: "fiz o sistema de pagamentos" },
          { id: "exp_1.b2", text: "Migrei para Kubernetes" },
        ],
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  mocks.opened.length = 0;
});
afterEach(cleanup);

describe("Revisar perfil", () => {
  it("lista os achados", () => {
    render(<ProfileEditor profile={profile()} onSave={() => true} />);
    expect(screen.queryByRole("list", { name: "Achados da revisão" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revisar perfil" }));
    const list = screen.getByRole("list", { name: "Achados da revisão" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(list.textContent).toContain("fiz o sistema de pagamentos");
    expect(list.textContent).toContain("Kubernetes");
  });

  it("mostra mensagem quando não há achados", () => {
    render(<ProfileEditor profile={profile({ experiences: [] })} onSave={() => true} />);
    fireEvent.click(screen.getByRole("button", { name: "Revisar perfil" }));
    expect(screen.getByText("Nenhum ponto de atenção encontrado.")).toBeTruthy();
  });

  it("Corrigir num bullet abre o assistente em reescrita para a experiência", () => {
    render(<ProfileEditor profile={profile()} onSave={() => true} />);
    fireEvent.click(screen.getByRole("button", { name: "Revisar perfil" }));
    fireEvent.click(screen.getByRole("button", { name: "Corrigir" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    const last = mocks.opened.at(-1)!;
    expect(last.target).toEqual({ kind: "bullets", expId: "exp_1" });
    expect(last.current.bullets).toEqual(["fiz o sistema de pagamentos", "Migrei para Kubernetes"]);
  });

  it("Corrigir no resumo longo abre o assistente com o alvo do resumo", () => {
    render(<ProfileEditor profile={profile({ experiences: [], summary: "a".repeat(601) })} onSave={() => true} />);
    fireEvent.click(screen.getByRole("button", { name: "Revisar perfil" }));
    fireEvent.click(screen.getByRole("button", { name: "Corrigir" }));
    expect(mocks.opened.at(-1)!.target).toEqual({ kind: "summary" });
    expect(mocks.opened.at(-1)!.current.text).toBe("a".repeat(601));
  });
});

describe("Sugestão de skills", () => {
  it("o chip adiciona a skill com years null ao rascunho e some", () => {
    const onSave = vi.fn(() => true);
    render(<ProfileEditor profile={profile()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Kubernetes" }));
    expect(screen.queryByRole("button", { name: "+ Kubernetes" })).toBeNull();
    expect(within(screen.getByRole("list", { name: "Competências" })).getByText("Kubernetes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar perfil" }));
    expect((onSave.mock.calls[0] as unknown as [Profile])[0].skills).toEqual([
      { name: "Kubernetes", years: null, stackId: "kubernetes" },
    ]);
  });
});
