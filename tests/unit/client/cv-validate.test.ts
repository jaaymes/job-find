import { describe, expect, it } from "vitest";
import { assembleCv } from "@/lib/client/cv/assemble";
import { countFlagged, flagBullets, letterFlags, violationKey } from "@/lib/client/cv/flags";
import { toPromptFeedback, validateTailored, type Violation } from "@/lib/client/cv/validate";
import { emptyProfile, type Profile } from "@/lib/shared/schemas/profile";
import type { TailoredDocs } from "@/lib/shared/schemas/tailored";

const profile: Profile = {
  ...emptyProfile(),
  name: "Ana Exemplo",
  headline: "Dev full stack",
  summary: "Dev com 8 anos de experiência.",
  skills: [
    { name: "React", years: 5, stackId: "react" },
    { name: "Next.js", years: 3, stackId: "nextjs" },
    { name: "Comunicação", years: null, stackId: null },
  ],
  experiences: [
    {
      id: "exp_1",
      company: "Empresa Ficticia",
      title: "Dev Sênior",
      startDate: "2021-01",
      endDate: null,
      bullets: [
        { id: "exp_1.b1", text: "Liderou a migração para React na Empresa Ficticia" },
        { id: "exp_1.b2", text: "Construiu páginas com React e Next.js" },
        { id: "exp_1.b3", text: "Melhorou o LCP em 25%" },
        { id: "exp_1.b4", text: "Atendeu 1k usuários por dia" },
      ],
    },
    {
      id: "exp_2",
      company: "Outra SA",
      title: "Dev",
      startDate: "2018",
      endDate: "2020-12",
      bullets: [{ id: "exp_2.b1", text: "Criou APIs; receita de 1,5k por mês" }],
    },
  ],
  education: [{ institution: "USP", degree: "Ciência da Computação", startYear: "2014", endYear: "2017" }],
};

const docs = (over: Partial<TailoredDocs["cv"]> = {}, coverLetter: string | null = null): TailoredDocs => ({
  cv: {
    headline: "Engenheira React",
    summary: "Foco em React.",
    skills: ["React"],
    experiences: [{ expId: "exp_1", bullets: [{ text: "Migração para React", sourceBulletIds: ["exp_1.b1"] }] }],
    ...over,
  },
  coverLetter,
});
const withSkill = (s: string) => docs({ skills: ["React", s] });
const withBullet = (expId: string, text: string, sourceBulletIds: string[]) =>
  docs({ experiences: [{ expId, bullets: [{ text, sourceBulletIds }] }] });
const withLetter = (l: string) => docs({}, l);
const kinds = (v: Violation[]) => v.map((x) => x.kind);

describe("validateTailored", () => {
  it("documento limpo não gera violações", () => {
    expect(validateTailored(profile, docs())).toEqual([]);
  });

  it("skill fora do perfil gera unknown_skill; skill do perfil e sinônimo passam", () => {
    expect(kinds(validateTailored(profile, withSkill("Kubernetes")))).toContain("unknown_skill");
    expect(validateTailored(profile, docs({ skills: ["ReactJS", "Next", "Comunicação"] }))).toEqual([]);
  });

  it("número fora da fonte gera unknown_number", () => {
    expect(kinds(validateTailored(profile, withBullet("exp_1", "Reduzi 40% do LCP", ["exp_1.b3"])))).toContain("unknown_number");
    expect(validateTailored(profile, withBullet("exp_1", "Reduzi 25% do LCP", ["exp_1.b3"]))).toEqual([]);
  });

  it("normaliza sinônimos de stack", () => {
    expect(kinds(validateTailored(profile, withBullet("exp_1", "Usei React.js e Next", ["exp_1.b2"])))).toEqual([]);
  });

  it("nome próprio e ano ausentes do perfil", () => {
    const v = validateTailored(profile, withBullet("exp_1", "Trabalhei na Google em 2015", ["exp_1.b1"]));
    expect(kinds(v)).toEqual(expect.arrayContaining(["unknown_name", "unknown_year"]));
    expect(v.find((x) => x.kind === "unknown_name")?.text).toBe("Google");
  });

  it("a carta também é validada, com o perfil inteiro", () => {
    expect(kinds(validateTailored(profile, withLetter("Tenho 10 anos de AWS")))).toContain("unknown_stack");
    expect(validateTailored(profile, withLetter("Tenho 8 anos de React desde 2018."))).toEqual([]);
    expect(validateTailored(profile, withLetter("Atenciosamente,\nAna Exemplo"))).toEqual([]);
  });

  it("números: 1.000, 1k e 1000 são equivalentes; vírgula decimal e %", () => {
    expect(validateTailored(profile, withBullet("exp_1", "1.000 usuários", ["exp_1.b4"]))).toEqual([]);
    expect(validateTailored(profile, withBullet("exp_1", "1000 usuários", ["exp_1.b4"]))).toEqual([]);
    expect(validateTailored(profile, withBullet("exp_2", "Gerou 1.500 por mês", ["exp_2.b1"]))).toEqual([]);
    expect(validateTailored(profile, withBullet("exp_2", "Gerou 1,5 mil", ["exp_2.b1"]))).toEqual([]);
    expect(kinds(validateTailored(profile, withBullet("exp_1", "2k usuários", ["exp_1.b4"])))).toContain("unknown_number");
    expect(validateTailored(profile, withBullet("exp_1", "25 % de ganho no LCP", ["exp_1.b3"]))).toEqual([]);
  });

  it("stack citada em bullet fora do perfil gera unknown_stack", () => {
    const v = validateTailored(profile, withBullet("exp_1", "Migrou para Kubernetes", ["exp_1.b1"]));
    expect(v.find((x) => x.kind === "unknown_stack")?.text).toBe("Kubernetes");
  });

  it("nome da vaga não gera alerta; siglas, meses e 'I' em inglês também não", () => {
    const job = { company: "Acme", title: "Dev React" };
    expect(validateTailored(profile, withLetter("Quero trabalhar na Acme."), job)).toEqual([]);
    expect(kinds(validateTailored(profile, withLetter("Quero trabalhar na Acme.")))).toContain("unknown_name");
    expect(validateTailored(profile, withLetter("Since March I improved the API and CI."))).toEqual([]);
  });

  it("início de frase não conta como nome próprio", () => {
    expect(validateTailored(profile, withLetter("Trabalho com React. Gosto de times."))).toEqual([]);
  });

  it("expId desconhecido ou repetido gera unknown_exp", () => {
    const unk = validateTailored(profile, withBullet("exp_9", "x", ["exp_9.b1"]));
    expect(kinds(unk)).toContain("unknown_exp");
    const dup = validateTailored(
      profile,
      docs({
        experiences: [
          { expId: "exp_1", bullets: [{ text: "Migração para React", sourceBulletIds: ["exp_1.b1"] }] },
          { expId: "exp_1", bullets: [{ text: "Migração para React", sourceBulletIds: ["exp_1.b1"] }] },
        ],
      }),
    );
    expect(dup).toEqual([{ kind: "unknown_exp", text: "exp_1", where: { expId: "exp_1", part: "cv" }, key: "exp_1@1" }]);
  });

  it("sourceBulletIds de outra experiência, inexistente ou vazio geram violação; números só das fontes válidas", () => {
    const cross = validateTailored(profile, withBullet("exp_1", "Gerou 1,5k", ["exp_2.b1"]));
    expect(cross.map((v) => [v.kind, v.text])).toEqual(
      expect.arrayContaining([["unknown_exp", "exp_2.b1"], ["unknown_number", "1,5k"]]),
    );
    expect(kinds(validateTailored(profile, withBullet("exp_1", "Migração", ["exp_1.b99"])))).toContain("unknown_exp");
    expect(validateTailored(profile, withBullet("exp_1", "Migração", []))[0].text).toBe("sem fonte");
  });

  it("não trava com entrada patológica (varredura linear)", () => {
    const big: Profile = {
      ...profile,
      experiences: Array.from({ length: 200 }, (_, i) => ({
        id: `exp_${i + 1}`,
        company: `Empresa ${i}`,
        title: "Dev",
        startDate: "2020",
        endDate: "2021",
        bullets: Array.from({ length: 10 }, (_, j) => ({ id: `exp_${i + 1}.b${j + 1}`, text: `Fez a coisa ${j}` })),
      })),
    };
    const t = Date.now();
    validateTailored(big, withLetter(`${"\n".repeat(30000)}${"a Q ".repeat(200)}${"1.".repeat(20000)}x ${"A".repeat(50000)}`));
    expect(Date.now() - t).toBeLessThan(500);
  });
});

describe("toPromptFeedback", () => {
  it("gera uma frase curta em pt-BR por violação", () => {
    const fb = toPromptFeedback(validateTailored(profile, withBullet("exp_1", "Reduzi 40% do LCP", ["exp_1.b3"])));
    expect(fb).toEqual(['no bullet 1 de exp_1: o número "40%" não está na fonte citada; use só números do bullet de origem (sourceBulletIds) ou remova-o']);
  });
});

describe("senioridade, certificação, números por extenso, siglas e empresas", () => {
  const letter = (t: string, job?: Parameters<typeof validateTailored>[2]) =>
    validateTailored({ ...profile, seniority: "mid", headline: "Dev pleno", experiences: profile.experiences.map((e) => ({ ...e, title: "Dev Pleno" })) }, withLetter(t), job);
  const texts = (v: Violation[]) => v.map((x) => x.text.toLowerCase());

  it("senioridade e cargos inventados", () => {
    expect(texts(letter("Sou desenvolvedora sênior React"))).toContain("senior");
    expect(texts(letter("Sou staff engineer e líder técnico"))).toEqual(expect.arrayContaining(["staff", "lider"]));
    expect(texts(letter("Atuei como arquiteto e gerente"))).toEqual(expect.arrayContaining(["arquiteto", "gerente"]));
  });
  it("termo presente no perfil ou na vaga não gera violação", () => {
    expect(letter("Sou desenvolvedora pleno com React.")).toEqual([]);
    expect(letter("Quero ser sênior", { title: "Dev Sênior" })).toEqual([]);
    expect(letter("Dear Hiring Manager, tenho React.")).toEqual([]);
  });
  it("certificações e formação inventadas", () => {
    expect(texts(letter("Tenho mestrado e MBA"))).toEqual(expect.arrayContaining(["mestrado", "mba"]));
    expect(texts(letter("Certificada PMP e CSM"))).toEqual(expect.arrayContaining(["certificada", "pmp", "csm"]));
    const withCert: Profile = { ...profile, summary: "Certificada PMP. Mestrado em computação." };
    expect(validateTailored(withCert, withLetter("Tenho certificado PMP e mestrado."))).toEqual([]);
  });
  it("números por extenso", () => {
    for (const t of ["Trabalhei dez anos", "Worked ten years", "Dobrei a receita", "Cortei pela metade", "Served hundreds of users"]) {
      expect(kinds(letter(t)), t).toContain("unknown_number");
    }
    expect(letter("Entreguei um projeto e a feature")).toEqual([]);
    const src: Profile = { ...profile, summary: "Dobrei a receita em dez meses." };
    expect(validateTailored(src, withLetter("Dobrei a receita em dez meses."))).toEqual([]);
    expect(validateTailored(profile, withBullet("exp_2", "Gerou 1,5 mil por mês", ["exp_2.b1"]))).toEqual([]);
  });
  it("siglas desconhecidas e empresas em minúsculas", () => {
    expect(texts(letter("Trabalhei na AWS e no BTG")).filter((t) => t !== "aws")).toEqual(["btg"]);
    expect(texts(letter("Trabalhei no itaú e na google"))).toEqual(expect.arrayContaining(["itau", "google"]));
    expect(letter("Trabalhei com a API e CI/CD, KPI, UX e LCP")).toEqual([]);
    expect(letter("Trabalhei na Empresa Ficticia e na google", { company: "Google" })).toEqual([]);
  });
  it("mês abreviado e ano corrente em experiência atual", () => {
    expect(validateTailored(profile, withLetter("Entrei em Jan e saí em Dec. Trabalho em React desde 2021."))).toEqual([]);
    const y = new Date().getFullYear();
    expect(validateTailored(profile, withLetter(`Atuo com React de 2021 a ${y}.`))).toEqual([]);
  });
});

describe("flagBullets / assembleCv com revisão", () => {
  const d = withBullet("exp_1", "Reduzi 40% do LCP", ["exp_1.b3"]);
  const violations = validateTailored(profile, d);

  it("marca o bullet, conta e respeita approvedFlags", () => {
    const cv = assembleCv(profile, d, "pt", { violations });
    const key = cv.experiences[0].bullets[0].key;
    expect(key).toMatch(/^exp_1@0#0:/);
    expect(cv.experiences[0].bullets[0].flagged).toBe(true);
    expect(countFlagged(cv)).toBe(1);
    const ok = assembleCv(profile, d, "pt", { violations, approvedFlags: [key] });
    expect(ok.experiences[0].bullets[0].flagged).toBe(false);
    expect(ok.experiences[0].bullets[0].violations).toHaveLength(1);
    expect(countFlagged(ok)).toBe(0);
  });

  it("a aprovação se perde quando o texto muda", () => {
    const key = assembleCv(profile, d, "pt", { violations }).experiences[0].bullets[0].key;
    const d2 = withBullet("exp_1", "Reduzi 41% do LCP", ["exp_1.b3"]);
    const cv2 = assembleCv(profile, d2, "pt", { violations: validateTailored(profile, d2), approvedFlags: [key] });
    expect(cv2.experiences[0].bullets[0].flagged).toBe(true);
  });

  it("sem revisão nada é marcado; flagBullets é pura", () => {
    const cv = assembleCv(profile, d, "pt");
    expect(countFlagged(cv)).toBe(0);
    expect(countFlagged(flagBullets(cv, violations))).toBe(1);
    expect(countFlagged(cv)).toBe(0);
  });

  it("expId repetido: chaves distintas e a repetição não é aprovável", () => {
    const dup = docs({
      experiences: [
        { expId: "exp_1", bullets: [{ text: "Migração para React", sourceBulletIds: ["exp_1.b1"] }] },
        { expId: "exp_1", bullets: [{ text: "Migração para React", sourceBulletIds: ["exp_1.b1"] }] },
      ],
    });
    const v = validateTailored(profile, dup);
    const cv = assembleCv(profile, dup, "pt", { violations: v });
    const [a, b] = cv.experiences;
    expect(a.bullets[0].key).not.toBe(b.bullets[0].key);
    expect(a.bullets[0].flagged).toBe(false);
    expect(b.bullets[0].flagged).toBe(true);
    const approved = assembleCv(profile, dup, "pt", { violations: v, approvedFlags: [a.bullets[0].key, b.bullets[0].key, "exp_1@1"] });
    expect(approved.experiences[1].bullets[0].flagged).toBe(true);
  });

  it("headline, summary e skills também são destacados e aprováveis", () => {
    const dd = docs({ headline: "Staff engineer React", summary: "Dez anos de React.", skills: ["React", "Kubernetes"] });
    const v = validateTailored(profile, dd);
    const cv = assembleCv(profile, dd, "pt", { violations: v });
    expect(cv.flags.headline.flagged).toBe(true);
    expect(cv.flags.summary.flagged).toBe(true);
    expect(cv.flags.skills.map((s) => s.flagged)).toEqual([false, true]);
    expect(countFlagged(cv)).toBe(3);
    expect(v.every((x) => violationKey(x) === x.key)).toBe(true);
    const ok = assembleCv(profile, dd, "pt", { violations: v, approvedFlags: [cv.flags.headline.key, cv.flags.skills[1].key] });
    expect(ok.flags.headline.flagged).toBe(false);
    expect(ok.flags.skills[1].flagged).toBe(false);
    expect(ok.flags.summary.flagged).toBe(true);
    expect(cv.flags.skills[1].key).toMatch(/^cv#skill#1:/);
  });

  it("carta: letterFlags", () => {
    const v = validateTailored(profile, withLetter("Tenho 10 anos de AWS"));
    const lf = letterFlags(v);
    expect(lf.flagged).toBe(true);
    expect(lf.key).toMatch(/^letter:/);
    expect(letterFlags(v, [lf.key!]).flagged).toBe(false);
    expect(letterFlags(validateTailored(profile, withLetter("Tenho React.")), []).flagged).toBe(false);
  });

  it("expId desconhecido: lança sem review, pula com review", () => {
    const bad = withBullet("exp_9", "x", ["exp_9.b1"]);
    expect(() => assembleCv(profile, bad, "pt")).toThrow();
    const cv = assembleCv(profile, bad, "pt", { violations: validateTailored(profile, bad) });
    expect(cv.experiences).toEqual([]);
  });
});
