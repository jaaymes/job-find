import { describe, expect, it } from "vitest";
import { assembleCv } from "@/lib/client/cv/assemble";
import { countFlagged, flagBullets, letterFlags, violationKey } from "@/lib/client/cv/flags";
import { prepareFacts, toPromptFeedback, validateTailored, type Violation } from "@/lib/client/cv/validate";
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
    // Mede a escala, não um valor absoluto: o tempo com a entrada 4x maior deve crescer ~4x (linear); um
    // algoritmo quadrático daria ~16x. A margem de 10x + 50 ms absorve ruído de máquina carregada.
    const run = (k: number) => {
      const letter = `${"\n".repeat(30000 * k)}${"a Q ".repeat(200 * k)}${"1.".repeat(20000 * k)}x ${"A".repeat(50000 * k)}`;
      const t = performance.now();
      validateTailored(big, withLetter(letter));
      return performance.now() - t;
    };
    const median = (k: number) => [run(k), run(k), run(k)].sort((a, b) => a - b)[1];
    run(1); // aquecimento
    const t1 = median(1);
    const t4 = median(4);
    expect(t4).toBeLessThan(10 * t1 + 50);
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
    expect(texts(letter("Sou staff engineer e líder técnico"))).toEqual(expect.arrayContaining(["staff", "lider tecnico"]));
    expect(texts(letter("Atuei como arquiteto e diretor"))).toEqual(expect.arrayContaining(["arquiteto", "diretor"]));
  });
  it("termo presente no perfil ou na vaga não gera violação", () => {
    expect(letter("Sou desenvolvedora pleno com React.")).toEqual([]);
    // Na carta, a vaga vale como fonte (citar o cargo e a empresa da vaga).
    expect(letter("Quero ser sênior", { title: "Dev Sênior" })).toEqual([]);
    expect(letter("Quero a vaga de Dev Sênior", { title: "Dev Sênior" })).toEqual([]);
    expect(letter("Dear Hiring Manager, tenho React.")).toEqual([]);
  });
  it("certificações e formação inventadas", () => {
    expect(texts(letter("Tenho mestrado e MBA"))).toEqual(expect.arrayContaining(["mestrado", "mba"]));
    expect(texts(letter("Certificada PMP e CSM"))).toEqual(expect.arrayContaining(["pmp", "csm"]));
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

describe("rodada 2: falsos positivos", () => {
  const texts = (v: Violation[]) => v.map((x) => x.text.toLowerCase());
  const bullet = (t: string) => validateTailored(profile, withBullet("exp_1", t, ["exp_1.b1"]));
  const mid: Profile = { ...profile, seniority: "mid", experiences: profile.experiences.map((e) => ({ ...e, title: "Dev Pleno" })) };

  it("siglas técnicas comuns não são nomes; 'na BTG' ainda é", () => {
    for (const a of ["IA", "AI", "ML", "LLM", "ETL", "BI", "CRM", "ERP", "DDD", "SOLID", "CRUD", "MVC", "JWT", "SSO", "LGPD", "E2E", "SSL", "RJ"]) {
      expect(bullet(`Liderou a migração para React com ${a} em RJ`).filter((v) => v.kind === "unknown_name"), a).toEqual([]);
    }
    expect(bullet("Liderou a migração para React, Dev II").filter((v) => v.kind === "unknown_name")).toEqual([]);
    expect(bullet("Liderou a migração para React na BTG").map((v) => v.text.toLowerCase())).toContain("btg");
    expect(bullet("Liderou a migração para React no BTG").map((v) => v.text.toLowerCase())).toContain("btg");
    expect(bullet("Liderou a migração para React na XYZW").map((v) => v.text)).toContain("XYZW");
    expect(bullet("Liderou a migração para React com XYZW").filter((v) => v.kind === "unknown_name")).toEqual([]);
    expect(kinds(bullet("Liderou a migração para React com PMP"))).toContain("unknown_name");
  });

  it("senioridade de outras pessoas não é autodescrição", () => {
    for (const t of ["Mentorei devs júnior", "Worked with senior engineers", "Reportava ao CTO", "Usei um state manager", "I lead frontend projects"]) {
      expect(bullet(t).filter((v) => v.kind === "unknown_name"), t).toEqual([]);
    }
    const sum = (t: string) => validateTailored(mid, docs({ summary: t }));
    expect(sum("Mentorei devs júnior e engenheiros sênior")).toEqual([]);
    expect(sum("Trabalho com times seniores e I lead frontend projects")).toEqual([]);
    expect(texts(validateTailored(mid, docs({ headline: "Desenvolvedora sênior" })))).toContain("senior");
    expect(validateTailored(mid, docs({ headline: "Desenvolvedora pleno" }))).toEqual([]);
  });

  it("rodada 3: dev singular, senioridade em bullets, produtos, ao/para o, certificado pela", () => {
    expect(texts(validateTailored(mid, docs({ summary: "Sou dev sênior com foco em React" })))).toContain("senior");
    expect(texts(validateTailored(mid, docs({ headline: "Senior Dev, React" })))).toContain("senior");
    expect(texts(bullet("Atuei como tech lead do squad"))).toContain("tech lead");
    expect(texts(bullet("Promovida a staff engineer"))).toContain("staff");
    for (const t of ["Mentorei devs júnior", "Worked with senior engineers", "Reportava ao CTO", "Reportava à CTO", "Reporting to the CTO"]) {
      expect(bullet(t).filter((v) => v.kind === "unknown_name"), t).toEqual([]);
    }
    expect(validateTailored({ ...profile, summary: "AWS" }, withBullet("exp_1", "Usei Amazon S3 e Google Analytics com React", ["exp_1.b1"])).filter((v) => v.kind === "unknown_name")).toEqual([]);
    expect(bullet("Usei SAP com React").filter((v) => v.kind === "unknown_name")).toEqual([]);
    expect(texts(validateTailored(profile, withLetter("Tenho certificado pela AWS")))).toContain("certificado pela");
  });

  it("Tech Lead gera uma só violação", () => {
    expect(validateTailored(mid, docs({ headline: "Tech Lead React" })).filter((v) => v.kind === "unknown_name")).toHaveLength(1);
  });

  it("números por extenso casam com os dígitos", () => {
    const p3: Profile = { ...profile, summary: "3 anos de React." };
    const L = (t: string, p = p3) => validateTailored(p, withLetter(t));
    expect(L("Tenho três anos de React")).toEqual([]);
    expect(L("Tenho dez anos de React").map((v) => v.text)).toEqual(["dez"]);
    expect(L("Saí em dez 2021 e em 12 dez, com React")).toEqual([]);
    expect(L("Usei two-factor, double-check e Three.js com React")).toEqual([]);
    expect(L("Cem por cento React").filter((v) => v.kind === "unknown_number").length).toBeLessThanOrEqual(1);
    expect(L("Tenho 3 anos")).toEqual([]);
  });

  it("empresas: produto e palavra composta não contam; certificados SSL não são credencial", () => {
    expect(validateTailored({ ...profile, summary: "AWS" }, withLetter("Usei google analytics e AWS S3 com React"))).toEqual([]);
    expect(validateTailored(profile, withLetter("Atuei em empresas norte-americanas com React"))).toEqual([]);
    expect(validateTailored(profile, withLetter("Renovei certificados SSL com React"))).toEqual([]);
    expect(texts(validateTailored(profile, withLetter("Sou certificado em Scrum")))).toContain("certificado em");
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

describe("títulos em inglês com perfil em português", () => {
  const enJob = { title: "Engineer", company: "Acme", summary: "Build things", descriptionHtml: "<p>Build things</p>" };
  const titled = (headline: string, p: Profile) =>
    validateTailored(p, { cv: { headline, summary: "Experience with React.", skills: ["React"], experiences: [] }, coverLetter: null }, enJob);
  const senior: Profile = { ...profile, seniority: "senior" };
  const mid: Profile = { ...profile, seniority: "mid", experiences: profile.experiences.map((e) => ({ ...e, title: "Dev Pleno" })) };

  it("perfil sênior: 'Senior Full Stack Developer' e 'Full Stack Software Engineer' não geram violação", () => {
    expect(titled("Senior Full Stack Developer", senior)).toEqual([]);
    expect(titled("Full Stack Software Engineer", senior)).toEqual([]);
    expect(titled("Frontend Engineer, Mobile and Cloud Platform", senior)).toEqual([]);
  });
  it("perfil pleno: só a senioridade inventada é marcada, não o cargo", () => {
    expect(titled("Senior Full Stack Developer", mid).map((v) => v.text.toLowerCase())).toEqual(["senior"]);
    expect(titled("Full Stack Software Engineer", mid)).toEqual([]);
  });
  it("continua marcando cargo de liderança inventado", () => {
    expect(titled("Staff Engineer", mid).map((v) => v.text.toLowerCase())).toContain("staff");
  });
});

describe("vaga como fonte só na carta (revisão final)", () => {
  const mid: Profile = { ...profile, seniority: "mid", headline: "Dev pleno", experiences: profile.experiences.map((e) => ({ ...e, title: "Dev Pleno" })) };
  const seniorJob = { title: "Desenvolvedora Sênior", company: "Acme", descriptionHtml: "<p>Monitoramento com Datadog e Sênior</p>" };
  const texts = (v: Violation[]) => v.map((x) => x.text.toLowerCase());

  it("CV: senioridade copiada da vaga (perfil Pleno, vaga Sênior) é violação; na carta, não", () => {
    expect(texts(validateTailored(mid, docs({ headline: "Desenvolvedora Sênior" }), seniorJob))).toContain("senior");
    expect(texts(validateTailored(mid, docs({ summary: "Desenvolvedora Sênior com React." }), seniorJob))).toContain("senior");
    expect(validateTailored(mid, withLetter("Quero a vaga de Dev Sênior"), seniorJob)).toEqual([]);
  });

  it("CV: ferramenta que só está na vaga é violação no bullet; na carta, não", () => {
    const b = validateTailored(mid, withBullet("exp_1", "Monitorei com Datadog", ["exp_1.b1"]), seniorJob);
    expect(b.map((v) => v.text)).toContain("Datadog");
    expect(validateTailored(mid, withLetter("Monitorei com Datadog"), seniorJob)).toEqual([]);
  });

  it("CV: empresa e sigla que só estão na vaga também viram violação no CV", () => {
    expect(texts(validateTailored(mid, docs({ summary: "Trabalhei na Acme com React." }), seniorJob))).toContain("acme");
    const job = { company: "XPTO Pagamentos" };
    expect(texts(validateTailored(mid, withBullet("exp_1", "Liderou a migração para React na XPTO", ["exp_1.b1"]), job))).toContain("xpto");
    expect(validateTailored(mid, withLetter("Quero trabalhar na XPTO."), job)).toEqual([]);
  });

  it("empresa inventada com palavras comuns ('at Cloud Data Software') é violação", () => {
    const v = validateTailored(profile, withBullet("exp_1", "Liderou a migração para React at Cloud Data Software", ["exp_1.b1"]));
    expect(kinds(v)).toContain("unknown_name");
    expect(validateTailored(profile, withBullet("exp_1", "Liderou a migração para React na Data Software", ["exp_1.b1"]))).not.toEqual([]);
    // Fora de contexto de empresa, as mesmas palavras continuam comuns.
    expect(validateTailored(profile, docs({ headline: "Cloud Data Software Engineer" }))).toEqual([]);
    // Mês depois de "em" não é empresa.
    expect(validateTailored(profile, withLetter("Entrei em Janeiro com React."))).toEqual([]);
    // Empresa do perfil com palavras comuns continua valendo.
    const own: Profile = { ...profile, experiences: profile.experiences.map((e, i) => (i === 0 ? { ...e, company: "Cloud Data Software" } : e)) };
    expect(validateTailored(own, withBullet("exp_1", "Liderou a migração para React na Cloud Data Software", ["exp_1.b1"]))).toEqual([]);
  });

  it("feedback ao modelo: no CV, não sugere a vaga como fonte", () => {
    const fb = toPromptFeedback(validateTailored(mid, docs({ headline: "Desenvolvedora Sênior" }), seniorJob));
    expect(fb.join("\n")).toMatch(/não copie da vaga/);
  });
});

describe("'Hiring Manager' não desloca os índices", () => {
  it("termo depois de 'Hiring Manager' ainda vê o 'à' do texto original", () => {
    const mid: Profile = { ...profile, seniority: "mid", experiences: profile.experiences.map((e) => ({ ...e, title: "Dev Pleno" })) };
    expect(validateTailored(mid, withLetter("Dear Hiring Manager, reportei à diretora da área com React."))).toEqual([]);
    expect(validateTailored(mid, withLetter("Dear Hiring Manager, sou diretora com React.")).map((v) => v.text)).toContain("diretora");
  });
});

describe("prepareFacts (memoização)", () => {
  it("devolve o mesmo objeto para o mesmo perfil/vaga e o resultado não muda", () => {
    const job = { title: "Dev", company: "Acme", descriptionHtml: "<p>React</p>" };
    const a = prepareFacts(profile, job);
    expect(prepareFacts(profile, job)).toBe(a);
    expect(prepareFacts(profile)).toBe(prepareFacts(profile));
    expect(prepareFacts({ ...profile }, job)).not.toBe(a);
    const d = withBullet("exp_1", "Reduzi 40% do LCP", ["exp_1.b3"]);
    expect(validateTailored(profile, d, job, a)).toEqual(validateTailored(profile, d, job));
    // Fatos de outro perfil não são usados por engano.
    expect(validateTailored(profile, d, job, prepareFacts({ ...profile, experiences: [] }, job))).toEqual(validateTailored(profile, d, job));
  });
});

describe("revisão 2: área depois de preposição e marcadores", () => {
  const texts = (v: Violation[]) => v.map((x) => x.text.toLowerCase());
  const bullet = (t: string) => validateTailored(profile, withBullet("exp_1", t, ["exp_1.b1"]));

  it("área/cargo depois de em/for/at não é empresa", () => {
    expect(validateTailored(profile, docs({ summary: "Especialista em Frontend e React" }))).toEqual([]);
    expect(validateTailored(profile, docs({ summary: "Atuação em Data e React" }))).toEqual([]);
    expect(validateTailored(profile, docs({ headline: "Desenvolvedora em Mobile" }))).toEqual([]);
    expect(validateTailored(profile, docs({ summary: "Built React apps for Mobile and Web" }))).toEqual([]);
    expect(validateTailored(profile, docs({ summary: "Trabalhei no Mobile com React" }))).toEqual([]);
  });
  it("empresa inventada continua marcada; comuns continuam livres", () => {
    expect(kinds(bullet("Liderou a migração para React at Cloud Data Software"))).toContain("unknown_name");
    expect(texts(bullet("Liderou a migração para React na BTG"))).toContain("btg");
    expect(validateTailored(profile, withLetter("Trabalho no Brasil com React."))).toEqual([]);
    expect(validateTailored(profile, withLetter("Atuei na equipe de Data com React."))).toEqual([]);
    expect(validateTailored(profile, withLetter("Entrei em Janeiro com React."))).toEqual([]);
  });
  it("marcador literal de dado ocultado é violação no CV e na carta, com feedback claro", () => {
    const b = bullet("[NOME] liderou a migração para React");
    expect(b.map((v) => v.text)).toEqual(["[NOME]"]);
    expect(toPromptFeedback(b)[0]).toMatch(/remova o marcador \[NOME\]/);
    expect(validateTailored(profile, withLetter("Sou [NOME], contato [EMAIL] e [TELEFONE], moro na [ENDERECO].")).map((v) => v.text)).toEqual(
      expect.arrayContaining(["[NOME]", "[EMAIL]", "[TELEFONE]", "[ENDERECO]"]),
    );
    // Fica fora do PDF: o bullet com o marcador é sinalizado.
    const d = withBullet("exp_1", "[NOME] liderou a migração para React", ["exp_1.b1"]);
    expect(assembleCv(profile, d, "pt", { violations: validateTailored(profile, d) }).experiences[0].bullets[0].flagged).toBe(true);
  });
});
