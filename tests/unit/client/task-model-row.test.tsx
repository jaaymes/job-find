import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskModelRow } from "@/components/settings/TaskModelRow";
import { defaultAiSettings } from "@/lib/client/ai/settings";

afterEach(cleanup);

function setup(settings = defaultAiSettings()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskModelRow task="analyze" settings={settings} onChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe("TaskModelRow", () => {
  it("provedor salvo que não está mais conectado mostra o aviso, não 'Automático' em silêncio", () => {
    setup({
      ...defaultAiSettings(),
      tasks: { extract: null, analyze: { provider: "anthropic", model: "m" }, cv: null },
    });
    expect(screen.getByText(/Provedor escolhido não está conectado/)).toBeTruthy();
    expect((screen.getByLabelText("Provedor") as HTMLSelectElement).selectedOptions[0].textContent).toBe(
      "Anthropic (Claude) (não conectado)",
    );
  });

  it("sem escolha salva, não mostra o aviso", () => {
    setup();
    expect(screen.queryByText(/Provedor escolhido não está conectado/)).toBeNull();
  });
});
