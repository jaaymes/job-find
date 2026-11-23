import { describe, expect, it } from "vitest";
import sample100 from "@/tests/fixtures/stacks/sample-100.json";
import { extractStacks, normalizeSkill, STACKS, STACKS_VERSION } from "@/lib/shared/stacks";

type Sample = { title: string; tags?: string[]; body: string; expected: string[] };

/** Fração de vagas cujo conjunto de ids extraídos é exatamente igual ao rotulado à mão. */
function precision(sample: Sample[]): number {
  let ok = 0;
  for (const job of sample) {
    const got = extractStacks({ title: job.title, tags: job.tags, body: job.body })
      .map((s) => s.id)
      .sort();
    const want = [...job.expected].sort();
    if (JSON.stringify(got) === JSON.stringify(want)) ok++;
    else console.info(`MISS "${job.title}": got=${got.join(",")} want=${want.join(",")}`);
  }
  return ok / sample.length;
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
    const p = precision(sample100 as Sample[]);
    console.info(`PRECISION=${p}`);
    expect(p).toBeGreaterThanOrEqual(0.9);
  });
});
