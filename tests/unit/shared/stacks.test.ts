import { describe, expect, it } from "vitest";
import sample100 from "@/tests/fixtures/stacks/sample-100.json";
import { extractStacks, normalizeSkill, STACKS, STACKS_VERSION } from "@/lib/shared/stacks";

type Sample = { title: string; tags?: string[]; body: string; expected: string[] };

/**
 * Fração de vagas cujo conjunto de ids extraídos é exatamente igual ao rotulado à mão.
 * Devolve também as vagas erradas, para a mensagem de falha.
 */
function precision(sample: Sample[]): { value: number; misses: string[] } {
  const misses: string[] = [];
  for (const job of sample) {
    const got = extractStacks({ title: job.title, tags: job.tags, body: job.body })
      .map((s) => s.id)
      .sort();
    const want = [...job.expected].sort();
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      misses.push(`"${job.title}": got=${got.join(",")} want=${want.join(",")}`);
    }
  }
  return { value: (sample.length - misses.length) / sample.length, misses };
}

describe("normalizeSkill", () => {
  it("normaliza variações para o id canônico", () => {
    expect(normalizeSkill("ReactJS")).toBe("react");
    expect(normalizeSkill("React.js")).toBe("react");
    expect(normalizeSkill("Node")).toBe("nodejs");
    expect(normalizeSkill("C#")).toBe("csharp");
    expect(normalizeSkill(".NET Core")).toBe("dotnet");
    expect(normalizeSkill("Golang")).toBe("go");
    expect(normalizeSkill("  Next.js ")).toBe("nextjs");
  });

  it("retorna null para o que não é stack", () => {
    expect(normalizeSkill("Excel")).toBeNull();
    expect(normalizeSkill("Pacote Office")).toBeNull();
    expect(normalizeSkill("")).toBeNull();
  });
});

describe("extractStacks", () => {
  it("aplica implies, ignora 'going' e marca inTitle", () => {
    const r = extractStacks({ title: "Dev Next.js", body: "Vamos going forward com TypeScript" });
    expect(r.map((s) => s.id).sort()).toEqual(["nextjs", "react", "typescript"]);
    expect(r.find((s) => s.id === "nextjs")?.inTitle).toBe(true);
    expect(r.find((s) => s.id === "react")?.inTitle).toBe(true);
    expect(r.find((s) => s.id === "typescript")?.inTitle).toBe(false);
  });

  it("distingue React Native, Java/JavaScript e SQL dentro de PostgreSQL", () => {
    const ids = (t: string, b = "") =>
      extractStacks({ title: t, body: b }).map((s) => s.id).sort();
    expect(ids("Dev", "React Native")).toEqual(["react", "react-native"]);
    expect(ids("Dev", "JavaScript")).toEqual(["javascript"]);
    expect(ids("Dev", "PostgreSQL e MySQL")).toEqual(["mysql", "postgresql"]);
    expect(ids("Dev", "SQL Server")).toEqual(["sqlserver"]);
  });

  it("go só casa como Golang ou 'Go' capitalizado em título/tags", () => {
    const ids = (i: Parameters<typeof extractStacks>[0]) => extractStacks(i).map((s) => s.id);
    expect(ids({ title: "Dev Go", body: "" })).toEqual(["go"]);
    expect(ids({ title: "Dev", tags: ["Go"], body: "" })).toEqual(["go"]);
    expect(ids({ title: "Dev", body: "go-to person, going far, let's go" })).toEqual([]);
    expect(ids({ title: "Dev", body: "Golang" })).toEqual(["go"]);
  });

  it("generaliza para Go/R soltos, TS/JS, C++17, Next 14 e Oracle empregador", () => {
    const ids = (b: string, title = "Dev") =>
      extractStacks({ title, body: b }).map((s) => s.id).sort();
    expect(ids("Experiência: Go.")).toEqual(["go"]);
    expect(ids("Buscamos um Go developer sênior")).toEqual(["go"]);
    expect(ids("Go ahead and apply! Go-getters, let's go, go-to-market.")).toEqual([]);
    expect(ids("Salário R$ 8.000 e linguagem R para análise")).toEqual(["r"]);
    expect(ids("Salário R$ 8.000")).toEqual([]);
    expect(ids("Linguagens: Python e R.")).toEqual(["python", "r"]);
    expect(ids("We love TS and JS")).toEqual(["javascript", "typescript"]);
    expect(ids("some C++17 and C++20 code")).toEqual(["cpp"]);
    expect(ids("Next 14 app")).toEqual(["nextjs", "react"]);
    expect(ids("Next.js 14 app")).toEqual(["nextjs", "react"]);
    expect(ids("Trabalhe na Oracle. Nosso CTO é ex-Oracle. At Oracle we grow.")).toEqual([]);
    expect(ids("Legado roda em Oracle e PL/SQL")).toEqual(["oracle"]);
    expect(ids("Spring is our busiest season")).toEqual([]);
    expect(ids("Java, Spring e Kafka")).toEqual(["java", "kafka", "spring"]);
    expect(ids("fast and swift delivery")).toEqual([]);
    expect(normalizeSkill("TS")).toBe("typescript");
    expect(normalizeSkill("ts")).toBe("typescript");
    expect(normalizeSkill("js")).toBe("javascript");
  });

  it("usa tags e não duplica", () => {
    const r = extractStacks({ title: "Dev React", tags: ["react", "Vue.js"], body: "React" });
    expect(r.map((s) => s.id).sort()).toEqual(["react", "vue"]);
  });
});

describe("dicionário", () => {
  it("tem versão e pelo menos 60 stacks, com ids únicos e implies válidos", () => {
    expect(STACKS_VERSION).toBeGreaterThanOrEqual(1);
    expect(STACKS.length).toBeGreaterThanOrEqual(60);
    const ids = new Set(STACKS.map((s) => s.id));
    expect(ids.size).toBe(STACKS.length);
    for (const s of STACKS) {
      for (const ref of [...(s.implies ?? []), ...(s.adjacent ?? [])]) expect(ids.has(ref)).toBe(true);
    }
    for (const id of ["react", "angular", "vue", "nextjs", "nodejs", "typescript", "java", "python", "go", "dotnet", "flutter", "kotlin"]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("pesos: 0,5 para genéricas e 1 para o resto", () => {
    expect(STACKS.find((s) => s.id === "git")?.weight).toBe(0.5);
    expect(STACKS.find((s) => s.id === "sql")?.weight).toBe(0.5);
    expect(STACKS.find((s) => s.id === "react")?.weight).toBe(1);
  });
});

describe("precisão na amostra rotulada", () => {
  it("tem 100 vagas e acerta pelo menos 90%", () => {
    expect(sample100).toHaveLength(100);
    const { value, misses } = precision(sample100 as Sample[]);
    expect(value, `precisão ${value}\n${misses.join("\n")}`).toBeGreaterThanOrEqual(0.9);
  });
});
