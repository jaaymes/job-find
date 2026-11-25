import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Skeleton } from "@/components/ui/skeleton";

afterEach(cleanup);

describe("Skeleton", () => {
  it("respeita movimento reduzido", () => {
    render(<Skeleton className="h-40" />);
    const status = screen.getByRole("status", { name: "Carregando" });
    expect(status.className).toContain("animate-pulse");
    expect(status.className).toContain("motion-reduce:animate-none");
    expect(status.className).toContain("h-40");
  });

  it("aceita um rótulo próprio", () => {
    render(<Skeleton label="Carregando a vaga" />);
    expect(screen.getByRole("status", { name: "Carregando a vaga" })).toBeTruthy();
  });
});
