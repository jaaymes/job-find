import { describe, expect, it } from "vitest";
import {
  ASSIST_QUESTIONS_V1,
  ASSIST_REWRITE_V1,
  ASSIST_WRITE_V1,
  sensitiveQuestion,
  type AssistTarget,
} from "@/lib/client/ai/prompts/profile.assist.v1";
import { emptyProfile, type Profile } from "@/lib/shared/schemas/profile";

const profile: Profile = {
  ...emptyProfile(),
  name: "Ana Exemplo",
  headline: "Desenvolvedora Frontend",
  summary: "Ana Exemplo constrói interfaces acessíveis. Contato: ana@exemplo.com",
  contact: { email: "ana@exemplo.com", phone: "+55 11 91234-5678", links: [] },
  skills: [{ name: "React", years: 5, stackId: "react" }],
  experiences: [
    {
      id: "exp_1",
      company: "Lumen Pay",
      title: "Frontend Sênior",
      startDate: "2019-01",
      endDate: "2023-06",
      bullets: [{ id: "exp_1.b1", text: "Reduziu o tempo de build em 60%" }],
    },
  ],
};

const bullets: AssistTarget = { kind: "bullets", expId: "exp_1" };
const targets: AssistTarget[] = [{ kind: "headline" }, { kind: "summary" }, bullets];
const qa = [{ question: "Qual foi o resultado?", answer: "Ana Exemplo cortou o build pela metade" }];
const current = { text: "Texto atual", bullets: null };

const builders = (target: AssistTarget) => ({
  questions: ASSIST_QUESTIONS_V1.buildUser({ profile, target }),
  write: ASSIST_WRITE_V1.buildUser({ profile, target, qa }),
  rewrite: ASSIST_REWRITE_V1.buildUser({ profile, target, current, tone: { tone: "default" } }),
});

describe("metadados dos prompts (D-02)", () => {
  it("ids, versão, tokens e temperaturas", () => {
    expect([ASSIST_QUESTIONS_V1, ASSIST_WRITE_V1, ASSIST_REWRITE_V1].map((p) => [p.id, p.version, p.maxOutputTokens, p.temperature])).toEqual([
      ["profile.assist.questions", 1, 800, 0.4],
      ["profile.assist.write", 1, 1500, 0.6],
      ["profile.assist.rewrite", 1, 1200, 0.3],
    ]);
  });
});

describe("schemas", () => {
  const q = (n: number, len = 10) => ({ questions: Array.from({ length: n }, () => "x".repeat(len)) });
  it("perguntas: 3 a 5 itens, até 160 caracteres", () => {
    expect(ASSIST_QUESTIONS_V1.schema.safeParse(q(2)).success).toBe(false);
    expect(ASSIST_QUESTIONS_V1.schema.safeParse(q(6)).success).toBe(false);
    for (const n of [3, 4, 5]) expect(ASSIST_QUESTIONS_V1.schema.safeParse(q(n)).success).toBe(true);
    expect(ASSIST_QUESTIONS_V1.schema.safeParse(q(3, 161)).success).toBe(false);
    expect(ASSIST_QUESTIONS_V1.schema.safeParse(q(3, 160)).success).toBe(true);
  });
  it("opções: exatamente 2", () => {
    const d = { text: "a", bullets: null };
    expect(ASSIST_WRITE_V1.schema.safeParse({ options: [d] }).success).toBe(false);
    expect(ASSIST_WRITE_V1.schema.safeParse({ options: [d, d] }).success).toBe(true);
    expect(ASSIST_WRITE_V1.schema.safeParse({ options: [d, d, d] }).success).toBe(false);
  });
  it("rascunho exige os dois campos (nullable, não optional)", () => {
    expect(ASSIST_REWRITE_V1.schema.safeParse({ draft: { text: "a" } }).success).toBe(false);
    expect(ASSIST_REWRITE_V1.schema.safeParse({ draft: { text: null, bullets: ["a"] } }).success).toBe(true);
  });
});

describe("buildUser", () => {
  for (const target of targets) {
    it(`protege contato e nome (${target.kind})`, () => {
      for (const user of Object.values(builders(target))) {
        expect(user).toContain('id="');
        expect(user).not.toContain("ana@exemplo.com");
        expect(user).not.toContain("91234-5678");
        expect(user).not.toContain("Ana Exemplo");
        expect(user).toContain("[NOME]");
      }
    });
  }
  it("bullets cita empresa e cargo da experiência", () => {
    for (const user of Object.values(builders(bullets))) {
      expect(user).toContain("Lumen Pay");
      expect(user).toContain("Frontend Sênior");
    }
  });
  it("respostas e texto atual vão em blocos delimitados", () => {
    expect(builders(bullets).write).toMatch(/<answers id="[a-z0-9]{8}">/);
    expect(builders(bullets).rewrite).toMatch(/<current_text id="[a-z0-9]{8}">/);
  });
});

describe("system do rewrite", () => {
  it("traduzir para inglês pede inglês", () => {
    const system = ASSIST_REWRITE_V1.system;
    const user = ASSIST_REWRITE_V1.buildUser({ profile, target: { kind: "summary" }, current, tone: { tone: "translate", lang: "en" } });
    expect(`${system}\n${user}`).toMatch(/English/);
  });
});

describe("sensitiveQuestion (RN-22)", () => {
  it.each(["Qual a sua idade?", "Você é casado?", "Qual seu CPF?", "What is your religion?", "¿Cuál es tu estado civil?", "Qual seu salário atual?"])(
    "bloqueia %s",
    (q) => expect(sensitiveQuestion(q)).toBe(true),
  );
  it.each(["Que tipo de produto você mais gosta de construir?", "Qual foi o maior desafio técnico?", "How did you manage the team?"])(
    "libera %s",
    (q) => expect(sensitiveQuestion(q)).toBe(false),
  );
});
