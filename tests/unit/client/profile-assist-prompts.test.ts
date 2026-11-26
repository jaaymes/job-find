import { describe, expect, it } from "vitest";
import {
  ASSIST_QUESTIONS_V1,
  ASSIST_REWRITE_V1,
  ASSIST_WRITE_V1,
  PROFILE_MAX_CHARS,
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
  it("perguntas: aparam espaços e rejeitam só espaços", () => {
    const r = ASSIST_QUESTIONS_V1.schema.safeParse({ questions: ["  a  ", "b", "c"] });
    expect(r.success && r.data.questions).toEqual(["a", "b", "c"]);
    expect(ASSIST_QUESTIONS_V1.schema.safeParse({ questions: ["", "  "] }).success).toBe(false);
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
  it("bullets: id, título e empresa ficam dentro do bloco do perfil, nenhum fora dele", () => {
    for (const user of Object.values(builders(bullets))) {
      const outside = user.replace(/<profile id="[a-z0-9]{8}">[\s\S]*?<\/profile id="[a-z0-9]{8}">/, "");
      expect(outside).not.toContain("Lumen Pay");
      expect(outside).not.toContain("Frontend Sênior");
      expect(outside).not.toContain("exp_1");
      expect(user).toMatch(/"targetExperienceId":"exp_1"/);
      expect(user).toContain("Lumen Pay");
      expect(user).toContain("Frontend Sênior");
    }
  });
  it("expId inexistente lança Error", () => {
    expect(() => ASSIST_QUESTIONS_V1.buildUser({ profile, target: { kind: "bullets", expId: "nao_existe" } })).toThrow(Error);
  });
  it("perfil acima do limite vira JSON válido com bullets podados, dos mais antigos aos mais novos", () => {
    const big = (id: string, startDate: string) => ({
      id,
      company: "Acme",
      title: "Dev",
      startDate,
      endDate: null,
      bullets: Array.from({ length: 40 }, (_, i) => ({ id: `${id}.b${i}`, text: `Entregou o item ${i} ${"x".repeat(400)}` })),
    });
    const huge: Profile = { ...profile, experiences: [big("exp_new", "2022-01"), big("exp_old", "2010-01")] };
    const user = ASSIST_QUESTIONS_V1.buildUser({ profile: huge, target: { kind: "summary" } });
    const inner = /<profile id="[a-z0-9]{8}">\n([\s\S]*)\n<\/profile id="[a-z0-9]{8}">/.exec(user)?.[1] ?? "";
    expect(inner.length).toBeLessThanOrEqual(PROFILE_MAX_CHARS);
    const parsed = JSON.parse(inner) as { experiences: { id: string; bullets: unknown[] }[] };
    const count = (id: string) => parsed.experiences.find((e) => e.id === id)?.bullets.length ?? -1;
    expect(count("exp_old")).toBeLessThan(40);
    expect(count("exp_new")).toBeGreaterThan(count("exp_old"));
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
  it.each(["Qual a sua idade?", "Você é casado?", "Qual seu CPF?", "What is your religion?", "¿Cuál es tu estado civil?", "Qual seu salário atual?", "Você tem filhos?", "Do you have kids?", "Qual a sua data de nascimento?", "Qual o seu endereço?", "How is your health?", "Qual a sua idade?", "Tem filhos?", "Você é solteiro?", "Is she married?", "Qual a cor da sua pele?"])(
    "bloqueia %s",
    (q) => expect(sensitiveQuestion(q)).toBe(true),
  );
  it.each(["Que tipo de produto você mais gosta de construir?", "Qual foi o maior desafio técnico?", "How did you manage the team?",
    "Você implementou single sign-on?",
    "Como você resolveu a race condition?",
    "O serviço tinha health check?",
    "Usou children props no React?",
    "Configurou o IP address do balanceador?",
    "Qual a idade média do sistema legado?",
    "Qual sua cor favorita?",
    "Você tem kids mode?",
    "o componente has children",
    "seu children prop",
    "Como você tratou o endereço de e-mail duplicado?",
  ])(
    "libera %s",
    (q) => expect(sensitiveQuestion(q)).toBe(false),
  );
});
