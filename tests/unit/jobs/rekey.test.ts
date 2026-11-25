import { describe, expect, it } from "vitest";
import { dedupeKey } from "@/lib/server/enrich/dedupe";
import { planRekey, type RekeyRow } from "@/lib/server/jobs/rekey";

/** Linha em Berlin/DE presencial, com uma chave antiga qualquer e URL já canônica por padrão. */
function row(id: number, company: string, title: string, url = `https://example.com/jobs/${id}`): RekeyRow {
  return { id, company, title, country: "DE", city: "Berlin", workMode: "onsite", dedupeKey: `old-${id}`, urlCanonical: url };
}

/** Mesma linha, mas já com a chave nova gravada (não precisa de recálculo). */
function current(id: number, company: string, title: string, url?: string): RekeyRow {
  const r = row(id, company, title, url);
  return { ...r, dedupeKey: dedupeKey(r) };
}

describe("planRekey", () => {
  it("agrupa empresa com e sem sufixo", () => {
    expect(
      planRekey([row(1, "resonads GmbH", "Backend Developer (m/w/d)"), row(2, "resonads", "Backend Developer")]).map(
        (g) => g.ids,
      ),
    ).toEqual([[1, 2]]);
  });

  it("agrupa pela URL nova", () => {
    const groups = planRekey([
      current(1, "Acme", "Backend Developer", "https://job-boards.greenhouse.io/acme/jobs/1"),
      current(2, "Acme", "Engenheiro de Software", "https://boards.greenhouse.io/acme/jobs/1"),
    ]);
    expect(groups.map((g) => g.ids)).toEqual([[1, 2]]);
    expect(groups[0].next[1].urlCanonical).toBe("https://boards.greenhouse.io/acme/jobs/1");
  });

  it("transitivo: 1~2 pela chave e 2~3 pela URL", () => {
    const groups = planRekey([
      row(1, "resonads GmbH", "Backend Developer (m/w/d)", "https://example.com/a"),
      row(2, "resonads", "Backend Developer", "https://job-boards.greenhouse.io/resonads/jobs/9"),
      row(3, "Outra", "Frontend Developer", "https://boards.greenhouse.io/resonads/jobs/9"),
    ]);
    expect(groups.map((g) => g.ids)).toEqual([[1, 2, 3]]);
    expect(Object.keys(groups[0].next).map(Number)).toEqual([1, 2, 3]);
  });

  it("linha que não muda não gera grupo", () => {
    expect(planRekey([current(1, "Acme", "Backend Developer"), current(2, "Acme", "Frontend Developer")])).toEqual([]);
  });

  it("linha cuja chave mudou sozinha gera grupo de um", () => {
    const r = row(1, "Acme GmbH", "Backend Developer");
    expect(planRekey([r])).toEqual([
      { ids: [1], next: { 1: { dedupeKey: dedupeKey(r), urlCanonical: "https://example.com/jobs/1" } } },
    ]);
  });

  it("linha cuja URL mudou sozinha gera grupo de um", () => {
    const groups = planRekey([current(1, "Acme", "Backend Developer", "https://www.example.com/jobs/1/")]);
    expect(groups).toEqual([
      { ids: [1], next: { 1: expect.objectContaining({ urlCanonical: "https://example.com/jobs/1" }) } },
    ]);
  });

  it("URL gravada que não é mais válida fica como está", () => {
    expect(planRekey([current(1, "Acme", "Backend Developer", "não é url")])).toEqual([]);
  });
});
