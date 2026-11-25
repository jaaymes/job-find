import { describe, expect, it } from "vitest";
import { dedupeKey } from "@/lib/server/enrich/dedupe";
import { findMixedTitleGroups, findReservedConflicts, planRekey, type RekeyRow } from "@/lib/server/jobs/rekey";

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

  describe("URLs reservadas por vagas sem empresa", () => {
    const reserved = new Set(["https://boards.greenhouse.io/x/1"]);
    const oldUrl = "https://job-boards.greenhouse.io/x/1";

    it("mantém a URL gravada quando a nova já é de uma vaga excluída", () => {
      expect(planRekey([current(1, "Acme", "Backend Developer", oldUrl)], reserved)).toEqual([]);
      const r = row(1, "Acme GmbH", "Backend Developer", oldUrl);
      expect(planRekey([r], reserved)).toEqual([
        { ids: [1], next: { 1: { dedupeKey: dedupeKey(r), urlCanonical: oldUrl } } },
      ]);
    });

    it("não agrupa pela URL reservada", () => {
      const groups = planRekey(
        [
          current(1, "Acme", "Backend Developer", oldUrl),
          current(2, "Outra", "Frontend Developer", "https://www.boards.greenhouse.io/x/1"),
        ],
        reserved,
      );
      expect(groups).toEqual([]);
    });

    it("findReservedConflicts devolve só as linhas cuja URL foi mantida", () => {
      const rows = [
        current(1, "Acme", "Backend Developer", oldUrl),
        current(2, "Acme", "Frontend Developer", "https://boards.greenhouse.io/x/2"),
        current(3, "Acme", "QA", "https://job-boards.greenhouse.io/x/3"),
      ];
      expect(findReservedConflicts(rows, reserved)).toEqual([1]);
    });
  });
});

describe("findMixedTitleGroups", () => {
  it("devolve só os grupos de mais de uma vaga cujos títulos normalizados diferem", () => {
    const rows = [
      // Mesmo título normalizado (marcador de gênero some): não entra.
      row(1, "resonads GmbH", "Backend Developer (m/w/d)"),
      row(2, "resonads", "Backend Developer"),
      // Juntas pela URL, com títulos diferentes: entra.
      current(3, "Acme", "Backend Developer", "https://job-boards.greenhouse.io/acme/jobs/1"),
      current(4, "Acme", "Engenheiro de Software", "https://boards.greenhouse.io/acme/jobs/1"),
      // Grupo de uma vaga só (chave mudou): não entra.
      row(5, "Solo", "Frontend Developer"),
    ];
    const groups = planRekey(rows);
    expect(groups.map((g) => g.ids)).toEqual([[1, 2], [3, 4], [5]]);
    expect(findMixedTitleGroups(groups, rows).map((g) => g.ids)).toEqual([[3, 4]]);
  });

  it("sem grupos, lista vazia", () => {
    expect(findMixedTitleGroups([], [])).toEqual([]);
  });
});
