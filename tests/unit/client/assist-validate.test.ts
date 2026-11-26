import { describe, expect, it } from "vitest";
import { validateAssistOutput } from "@/lib/client/cv/validate";
import { emptyProfile, type Profile } from "@/lib/shared/schemas/profile";

const profile: Profile = {
  ...emptyProfile(),
  name: "Ana Exemplo",
  skills: [
    { name: "React", years: null, stackId: "react" },
    { name: "TypeScript", years: null, stackId: "typescript" },
  ],
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

const run = (text: string, source = "") => validateAssistOutput(profile, source, [text]);

describe("validateAssistOutput (RN-20)", () => {
  it("número desconhecido vira unknown_number", () => {
    const v = run("Aumentei a conversão em 35%");
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ kind: "unknown_number", text: "35%", where: { part: "cv" } });
    expect(v[0].key).toMatch(/\S/);
  });
  it("número presente no sourceText passa", () => {
    expect(run("Aumentei a conversão em 35%", "aumentou a conversão em 35%")).toEqual([]);
  });
  it("número por extenso", () => {
    expect(run("Liderei dez pessoas").map((x) => x.kind)).toEqual(["unknown_number"]);
    expect(run("Liderei 10 pessoas", "eram 10 pessoas")).toEqual([]);
    expect(run("Liderei dez pessoas", "eram 10 pessoas")).toEqual([]);
    expect(run("Led seventy people").map((x) => x.kind)).toEqual(["unknown_number"]);
    expect(run("Lideré a setenta personas", "70 personas")).toEqual([]);
  });
  it("número de 4 dígitos dito pelo usuário não é ano", () => {
    expect(run("Atendi 2000 usuários simultâneos", "atendemos 2000 usuários")).toEqual([]);
    expect(run("Processei mais de 1500 pedidos por minuto", "1500 pedidos por minuto")).toEqual([]);
  });
  it("número de 4 dígitos inventado ou usado como data continua barrado", () => {
    expect(run("Atendi 2000 usuários simultâneos").map((x) => x.kind)).toEqual(["unknown_year"]);
    expect(run("Em 2015 migrei o sistema", "2015").map((x) => x.kind)).toEqual(["unknown_year"]);
    expect(run("Atuei de 2015 a 2017", "2015 2017").map((x) => x.kind)).toEqual(["unknown_year", "unknown_year"]);
    expect(run("Atuo desde 2015.", "2015").map((x) => x.kind)).toEqual(["unknown_year"]);
  });
  it("ano só vale do perfil, mesmo com 2015 no sourceText", () => {
    expect(run("Desde 2015 atuo com front-end", "2015").map((x) => x.kind)).toEqual(["unknown_year"]);
    expect(run("Desde 2019 atuo com front-end")).toEqual([]);
  });
  it("nome próprio fora do perfil", () => {
    expect(run("Trabalhei na Nubank").map((x) => x.kind)).toEqual(["unknown_name"]);
    expect(run("Trabalhei na Nubank", "Nubank").map((x) => x.kind)).toEqual(["unknown_name"]);
  });
  it("stack: perfil ou sourceText", () => {
    expect(run("Usei Kubernetes").map((x) => x.kind)).toEqual(["unknown_stack"]);
    expect(run("Usei Kubernetes", "usei kubernetes no deploy")).toEqual([]);
    expect(run("Usei React")).toEqual([]);
  });
  it("sixty equivale a 60 do perfil", () => {
    expect(run("Led sixty people")).toEqual([]);
  });
  it("tradução preserva fatos do perfil", () => {
    expect(run("Reduced build time by 60% at Lumen Pay")).toEqual([]);
    expect(run("Reduced build time by 70% at Lumen Pay").map((x) => x.kind)).toEqual(["unknown_number"]);
  });
  it("texto fiel ao perfil passa", () => {
    expect(run("Reduziu o tempo de build em 60%")).toEqual([]);
  });
});

describe("anos no modo assist (#18)", () => {
  const noYears: Profile = { ...profile, experiences: [{ ...profile.experiences[0], startDate: "2020-01", endDate: "2021-01" }] };
  const kinds = (text: string, source: string, p: Profile = noYears) => validateAssistOutput(p, source, [text]).map((x) => x.kind);

  it("ano inventado em qualquer posição da frase é barrado", () => {
    expect(kinds("Durante 2019 entreguei a migração", "entreguei a migração")).toEqual(["unknown_year"]);
    expect(kinds("2019 marcou a migração", "a migração")).toEqual(["unknown_year"]);
    expect(kinds("Durante 2019 entreguei a migração", "em 2019 entreguei a migração")).toEqual(["unknown_year"]);
    expect(kinds("2019 marcou a migração", "2019 foi o ano")).toEqual(["unknown_year"]);
  });
  it("ano que só vem das respostas e é usado como data continua barrado", () => {
    expect(kinds("Em 2019 liderei a migração", "em 2019 eu liderei a migração")).toEqual(["unknown_year"]);
  });
  it("quantidade das respostas (número + palavra iguais) passa", () => {
    expect(kinds("Mantive uma plataforma de 2000 usuários", "2000 usuários")).toEqual([]);
    expect(kinds("Enviei 1500 e-mails por dia", "1500 e-mails")).toEqual([]);
  });
  it("quantidade com palavra diferente da resposta é barrada", () => {
    expect(kinds("Atendi 2000 clientes", "2000 usuários")).toEqual(["unknown_year"]);
  });
  it("ano do perfil passa", () => {
    expect(kinds("Desde 2021 atuo com front-end", "", { ...noYears, experiences: [{ ...noYears.experiences[0], startDate: "2021-03" }] })).toEqual([]);
  });
});

describe("restoreName e o marcador [NOME] (#30)", () => {
  it("o validador marca [NOME] que sobrou na saída", () => {
    expect(run("[NOME] lidera times").map((x) => x.kind)).toEqual(["unknown_name"]);
  });
});

