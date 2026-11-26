import { describe, expect, it } from "vitest";
import { reviewProfile, suggestSkills } from "@/lib/client/profile/review";
import { emptyProfile, type Profile } from "@/lib/shared/schemas/profile";

function withBullets(...texts: string[]): Profile {
  return {
    ...emptyProfile(),
    experiences: [
      {
        id: "exp_1",
        company: "Acme",
        title: "Dev",
        startDate: null,
        endDate: null,
        bullets: texts.map((text, i) => ({ id: `exp_1.b${i + 1}`, text })),
      },
    ],
  };
}

const kinds = (p: Profile) => reviewProfile(p).map((f) => f.kind);

describe("reviewProfile: verbo de ação", () => {
  it("'fiz' fica fora da lista e das terminações", () => {
    const f = reviewProfile(withBullets("fiz o sistema de pagamentos"));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      kind: "bullet_no_verb",
      where: { field: "bullet", expId: "exp_1", bulletId: "exp_1.b1" },
    });
  });

  it.each(["Desenvolvi o sistema de pagamentos", "Liderou a migração do banco", "Built the payments system"])(
    "aceita %s",
    (text) => expect(kinds(withBullets(text))).toEqual([]),
  );

  it.each(["Implementamos o checkout", "Leading a squad"])("aceita %s", (text) => expect(kinds(withBullets(text))).toEqual([]));

  it("'Responsável pelo sistema' não tem verbo de ação", () => {
    expect(kinds(withBullets("Responsável pelo sistema"))).toEqual(["bullet_no_verb"]);
  });

  it("ignora marcador no começo e bullet vazio", () => {
    expect(kinds(withBullets("- Reduzi o custo em 20%", "   "))).toEqual([]);
  });
});

describe("reviewProfile: tamanho", () => {
  it("bullet de 201 caracteres é longo; 200 não é", () => {
    expect(kinds(withBullets("Criei " + "a".repeat(194)))).toEqual([]);
    expect(kinds(withBullets("Criei " + "a".repeat(195)))).toEqual(["bullet_long"]);
  });

  it("resumo de 601 caracteres é longo; 600 não é", () => {
    expect(kinds({ ...emptyProfile(), summary: "a".repeat(600) })).toEqual([]);
    const f = reviewProfile({ ...emptyProfile(), summary: "a".repeat(601) });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "summary_long", where: { field: "summary" } });
  });
});

describe("suggestSkills", () => {
  it("sugere stack citada no bullet e ausente de skills", () => {
    const p = withBullets("Migrei para Kubernetes");
    expect(suggestSkills(p)).toEqual([{ stackId: "kubernetes", label: "Kubernetes" }]);
    expect(reviewProfile(p)).toEqual([
      expect.objectContaining({ kind: "skill_missing", where: { field: "skills", stackId: "kubernetes" } }),
    ]);
  });

  it("a mensagem diz que aparece ou está implícita nas realizações", () => {
    const f = reviewProfile(withBullets("Migrei para Kubernetes"));
    expect(f[0].message).toBe("Kubernetes aparece ou está implícita nas suas realizações, mas não está nas competências.");
  });

  it("não sugere quando a skill já existe", () => {
    const p = { ...withBullets("Migrei para Kubernetes"), skills: [{ name: "K8s", years: null, stackId: "kubernetes" }] };
    expect(suggestSkills(p)).toEqual([]);
    expect(kinds(p)).toEqual([]);
  });

  it("lê também os bullets dos projetos", () => {
    const p: Profile = {
      ...emptyProfile(),
      projects: [{ id: "proj_1", name: "X", link: null, stacks: [], bullets: [{ id: "proj_1.b1", text: "Deploy em Kubernetes" }] }],
    };
    expect(suggestSkills(p).map((s) => s.stackId)).toEqual(["kubernetes"]);
  });
});
