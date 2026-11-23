import { describe, expect, it } from "vitest";
import { bandFor, indexProfile, scoreJob } from "@/lib/client/score/score";
import { emptyProfile, type Profile } from "@/lib/shared/schemas/profile";
import type { JobSummary } from "@/lib/shared/types/job";

const NOW = new Date("2026-11-23T12:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function profile(
  skills: (string | [string, number | null])[],
  seniority: Profile["seniority"] = "senior",
  englishLevel: Profile["englishLevel"] = "advanced",
  location: string | null = "São Paulo, BR",
): Profile {
  return {
    ...emptyProfile(),
    seniority,
    englishLevel,
    location,
    skills: skills.map((s) => {
      const [id, years] = Array.isArray(s) ? s : ([s, 5] as const);
      return { name: id, years, stackId: id };
    }),
  };
}
const pi = (...args: Parameters<typeof profile>) => indexProfile(profile(...args));

function job(over: Partial<JobSummary> & { age?: string } = {}): JobSummary {
  const { age = "2h", ...rest } = over;
  const ms = age.endsWith("d") ? Number.parseInt(age) * DAY : Number.parseInt(age) * HOUR;
  return {
    id: 1,
    title: "Desenvolvedor",
    company: "Acme",
    companyLogoUrl: null,
    summary: "",
    country: "BR",
    city: null,
    origin: "national",
    acceptsBrazil: true,
    workMode: "remote",
    seniority: "senior",
    language: "pt",
    stacks: ["react"],
    sources: ["greenhouse"],
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    publishedAt: new Date(NOW.getTime() - ms).toISOString(),
    ...rest,
  };
}

const crit = (r: ReturnType<typeof scoreJob>, c: string) => r.breakdown.find((b) => b.criterion === c)!;

describe("scoreJob", () => {
  it("perfil aderente a vaga recente é faixa alta, com os cinco critérios e pesos 45/20/15/15/5", () => {
    const r = scoreJob(
      pi(["react", "nextjs", "typescript"]),
      job({ stacks: ["react", "nextjs", "typescript", "graphql"], age: "2h" }),
      NOW,
    );
    expect(r.band).toBe("alta");
    expect(r.breakdown.map((b) => [b.criterion, b.weight])).toEqual([
      ["stack", 45],
      ["seniority", 20],
      ["language", 15],
      ["location", 15],
      ["recency", 5],
    ]);
    expect(r.breakdown.every((b) => b.reason.length > 0)).toBe(true);
  });

  it("score é a média ponderada dos critérios disponíveis", () => {
    const r = scoreJob(pi(["react"]), job({ stacks: ["react"] }), NOW);
    expect(r.score).toBe(100);
    const lowSen = scoreJob(pi(["react"], "junior"), job({ seniority: "lead" }), NOW);
    // senioridade 0 (3 níveis de distância): (45 + 0 + 15 + 15 + 5) / 100
    expect(lowSen.score).toBe(80);
  });

  describe("idioma", () => {
    it("vaga em inglês e perfil sem inglês (ou básico) vale 0", () => {
      expect(crit(scoreJob(pi(["react"], "senior", "none"), job({ language: "en" }), NOW), "language").value).toBe(0);
      expect(crit(scoreJob(pi(["react"], "senior", "basic"), job({ language: "en" }), NOW), "language").value).toBe(0);
    });
    it("vaga em inglês e perfil intermediário ou melhor vale 100", () => {
      expect(crit(scoreJob(pi(["react"], "senior", "intermediate"), job({ language: "en" }), NOW), "language").value).toBe(100);
    });
    it("vaga em português não exige inglês", () => {
      expect(crit(scoreJob(pi(["react"], "senior", "none"), job({ language: "pt" }), NOW), "language").value).toBe(100);
    });
    it("vaga em inglês e perfil sem nível de inglês: sem dado", () => {
      expect(crit(scoreJob(pi(["react"], "senior", null), job({ language: "en" }), NOW), "language").available).toBe(false);
    });
  });

  describe("senioridade", () => {
    it.each([
      ["senior", "senior", 100],
      ["mid", "senior", 50],
      ["junior", "senior", 0],
      ["lead", "senior", 50],
    ] as const)("perfil %s x vaga %s = %i", (mine, theirs, value) => {
      expect(crit(scoreJob(pi(["react"], mine), job({ seniority: theirs }), NOW), "seniority").value).toBe(value);
    });
    it("vaga sem senioridade ou perfil sem senioridade: sem dado", () => {
      expect(crit(scoreJob(pi(["react"]), job({ seniority: null }), NOW), "seniority").available).toBe(false);
      expect(crit(scoreJob(pi(["react"], null), job(), NOW), "seniority").available).toBe(false);
    });
    it("redistribui o peso: sem senioridade, o score usa só os outros critérios", () => {
      const r = scoreJob(pi(["react"]), job({ seniority: null }), NOW);
      expect(r.score).toBe(100);
    });
  });

  describe("local", () => {
    it("aceita Brasil = 100; não aceita = 0; desconhecido = sem dado", () => {
      expect(crit(scoreJob(pi(["react"]), job({ acceptsBrazil: true }), NOW), "location").value).toBe(100);
      expect(crit(scoreJob(pi(["react"]), job({ acceptsBrazil: false }), NOW), "location").value).toBe(0);
      expect(crit(scoreJob(pi(["react"]), job({ acceptsBrazil: null }), NOW), "location").available).toBe(false);
    });
    it("presencial na mesma cidade do perfil vale 100 mesmo sem aceitar Brasil", () => {
      const r = scoreJob(pi(["react"]), job({ workMode: "onsite", city: "São Paulo", acceptsBrazil: false }), NOW);
      expect(crit(r, "location").value).toBe(100);
    });
    it("presencial em outra cidade e sem aceitar Brasil vale 0", () => {
      const r = scoreJob(pi(["react"]), job({ workMode: "hybrid", city: "Lisboa", acceptsBrazil: null }), NOW);
      expect(crit(r, "location").value).toBe(0);
    });
    it("compara a cidade sem acento e sem diferenciar maiúsculas", () => {
      const r = scoreJob(pi(["react"], "senior", "advanced", "SAO PAULO - SP"), job({ workMode: "onsite", city: "São Paulo", acceptsBrazil: false }), NOW);
      expect(crit(r, "location").value).toBe(100);
    });
  });

  describe("recência", () => {
    it.each([
      ["2h", 100],
      ["3d", 100],
      ["16d", 52], // 100 * (30 - 16) / 27, arredondado
      ["30d", 0],
      ["45d", 0],
    ])("vaga de %s vale %i", (age, value) => {
      expect(Math.round(crit(scoreJob(pi(["react"]), job({ age }), NOW), "recency").value)).toBe(value);
    });
  });

  describe("stacks", () => {
    const stackValue = (mine: Parameters<typeof pi>[0], j: Partial<JobSummary>) =>
      crit(scoreJob(pi(mine), job(j), NOW), "stack").value;

    it("interseção ponderada pelas stacks da vaga", () => {
      expect(stackValue(["react"], { stacks: ["react", "vue"] })).toBe(50);
      expect(stackValue(["react"], { stacks: ["vue"] })).toBe(0);
    });
    it("vaga sem stacks: sem dado", () => {
      expect(crit(scoreJob(pi(["react"]), job({ stacks: [] }), NOW), "stack").available).toBe(false);
    });
    it("stack no título vale o dobro", () => {
      // react (no título, peso 2) casa; vue (peso 1) não: 2 / 3
      expect(stackValue(["react"], { title: "Engenheiro React", stacks: ["react", "vue"] })).toBeCloseTo(66.67, 1);
    });
    it("git e sql valem a metade", () => {
      // react (1) casa; git (0,5) não: 1 / 1,5
      expect(stackValue(["react"], { stacks: ["react", "git"] })).toBeCloseTo(66.67, 1);
      expect(stackValue(["react"], { stacks: ["react", "sql"] })).toBeCloseTo(66.67, 1);
    });
    it("typescript e javascript dão 0,5 de crédito um ao outro", () => {
      expect(stackValue(["javascript"], { stacks: ["typescript"] })).toBe(50);
      expect(stackValue(["typescript"], { stacks: ["javascript"] })).toBe(50);
      expect(stackValue(["typescript", "javascript"], { stacks: ["typescript"] })).toBe(100);
    });
    it("poucos anos de experiência reduzem o crédito (fator entre 0,6 e 1)", () => {
      expect(stackValue([["react", 0]], { stacks: ["react"] })).toBeCloseTo(60, 5);
      expect(stackValue([["react", 1.5]], { stacks: ["react"] })).toBeCloseTo(80, 5);
      expect(stackValue([["react", 3]], { stacks: ["react"] })).toBe(100);
      expect(stackValue([["react", 20]], { stacks: ["react"] })).toBe(100);
    });
    it("competência sem stackId é reconhecida pelo nome", () => {
      const p = { ...profile([]), skills: [{ name: "ReactJS", years: 5, stackId: null }] };
      expect(crit(scoreJob(indexProfile(p), job({ stacks: ["react"] }), NOW), "stack").value).toBe(100);
    });
  });

  it("sem nenhum critério disponível o score é 0 (baixa)", () => {
    const empty = indexProfile({ ...emptyProfile() });
    const r = scoreJob(
      empty,
      job({ stacks: [], seniority: null, acceptsBrazil: null, language: "en", publishedAt: "invalid" }),
      NOW,
    );
    expect(r.breakdown.every((b) => !b.available)).toBe(true);
    expect(r.score).toBe(0);
    expect(r.band).toBe("baixa");
  });
});

describe("faixas", () => {
  it.each([
    [100, "alta"],
    [70, "alta"],
    [69, "media"],
    [40, "media"],
    [39, "baixa"],
    [0, "baixa"],
  ] as const)("%i -> %s", (score, band) => {
    expect(bandFor(score)).toBe(band);
  });
});

describe("desempenho", () => {
  it("30 vagas em menos de 5 ms (mediana de 21 execuções, após aquecimento)", () => {
    const index = pi(["react", "nextjs", "typescript", "node", "postgres", "docker", "git"]);
    const jobs = Array.from({ length: 30 }, (_, i) =>
      job({
        id: i,
        title: `Desenvolvedor ${i % 2 ? "React" : "Node"} ${i}`,
        stacks: ["react", "typescript", "sql", "docker", "aws"].slice(0, 2 + (i % 4)),
        age: `${i + 1}h`,
      }),
    );
    const run = () => {
      const t0 = performance.now();
      for (const j of jobs) scoreJob(index, j, NOW);
      return performance.now() - t0;
    };
    for (let i = 0; i < 10; i++) run();
    const times = Array.from({ length: 21 }, run).sort((a, b) => a - b);
    expect(times[10]).toBeLessThan(5);
  });
});
