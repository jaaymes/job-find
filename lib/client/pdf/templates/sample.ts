import { emptyProfile, type Profile } from "@/lib/shared/schemas/profile";

/** Perfil fictício da prévia dos modelos quando ainda não há CV montado (nenhum dado real do usuário). */
export function sampleProfile(): Profile {
  return {
    ...emptyProfile(),
    name: "Ana Souza",
    headline: "Desenvolvedora Full Stack",
    location: "São Paulo, SP",
    seniority: "senior",
    summary:
      "Desenvolvedora com 7 anos de experiência em produtos web de alto tráfego, do front-end em React às APIs em Node.js. Gosto de medir o impacto do que entrego.",
    contact: { email: "ana.souza@exemplo.com", phone: "(11) 90000-0000", links: ["linkedin.com/in/anasouza"] },
    skills: ["TypeScript", "React", "Next.js", "Node.js", "PostgreSQL", "Docker", "AWS", "Jest"].map((name) => ({
      name,
      years: null,
      stackId: null,
    })),
    experiences: [
      {
        id: "exp_1",
        company: "Loja Digital",
        title: "Desenvolvedora Sênior",
        startDate: "2021-03",
        endDate: null,
        bullets: [
          { id: "exp_1.b1", text: "Reduzi o tempo de carregamento do checkout em 40% com renderização no servidor." },
          { id: "exp_1.b2", text: "Liderei a migração de 12 serviços para TypeScript, sem parar as entregas." },
          { id: "exp_1.b3", text: "Criei a biblioteca de componentes usada por 5 times de produto." },
        ],
      },
      {
        id: "exp_2",
        company: "Fintech Azul",
        title: "Desenvolvedora Pleno",
        startDate: "2018-01",
        endDate: "2021-02",
        bullets: [
          { id: "exp_2.b1", text: "Construí a API de pagamentos recorrentes que processa 2 milhões de cobranças por mês." },
          { id: "exp_2.b2", text: "Automatizei os testes de integração e cortei pela metade os erros em produção." },
        ],
      },
    ],
    education: [{ institution: "Universidade de São Paulo", degree: "Bacharelado em Ciência da Computação", startYear: "2013", endYear: "2017" }],
    projects: [
      {
        id: "proj_1",
        name: "Painel de Vagas",
        link: null,
        stacks: ["Next.js", "PostgreSQL"],
        bullets: [{ id: "proj_1.b1", text: "Agregador de vagas com busca por stack e filtros salvos." }],
      },
    ],
    certifications: [{ name: "AWS Certified Developer", issuer: "AWS", year: "2023" }],
    languages: [
      { name: "Português", level: "native" },
      { name: "Inglês", level: "fluent" },
    ],
    highlights: ["exp_1.b1", "exp_2.b1"],
  };
}
