/**
 * Catálogo único de fontes de vagas. Cada fonte tem id, rótulo da UI e confiança.
 * A ordem daqui é a do filtro "Fonte". O tipo `SourceId`, o schema da API, o parser da URL, os
 * rótulos e a confiança derivam desta lista; o registry de conectores (server-only) é tipado como
 * `Record<SourceId, Connector>`, então o TypeScript acusa se faltar um conector para algum id.
 *
 * Confiança (usada na fusão por `dedupe_key`): 3 = ATS da própria empresa (só a empresa publica);
 * 2 = agregador ou job board; 1 = conteúdo livre de usuário (comentário no HN, issue no GitHub),
 * onde qualquer pessoa escreve empresa e cargo.
 */
export const SOURCES = [
  { id: "himalayas", label: "Himalayas", trust: 2 },
  { id: "greenhouse", label: "Greenhouse", trust: 3 },
  { id: "ashby", label: "Ashby", trust: 3 },
  { id: "lever", label: "Lever", trust: 3 },
  { id: "jobicy", label: "Jobicy", trust: 2 },
  { id: "github", label: "GitHub", trust: 1 },
  { id: "wwr", label: "We Work Remotely", trust: 2 },
  { id: "remoteok", label: "RemoteOK", trust: 2 },
  { id: "hn", label: "Hacker News", trust: 1 },
  { id: "fourdayweek", label: "4 Day Week", trust: 2 },
  { id: "getonboard", label: "Get on Board", trust: 2 },
  { id: "smartrecruiters", label: "SmartRecruiters", trust: 3 },
  { id: "arbeitnow", label: "Arbeitnow", trust: 2 },
  { id: "gupy", label: "Gupy", trust: 3 },
  { id: "linkedin", label: "LinkedIn", trust: 2 },
  { id: "remotejobs", label: "RemoteJobs.org", trust: 2 },
] as const;

export type SourceId = (typeof SOURCES)[number]["id"];

/** Ids na ordem do catálogo; serve para `z.enum` e `parseAsStringLiteral`. */
export const SOURCE_IDS = SOURCES.map((s) => s.id) as unknown as readonly [SourceId, ...SourceId[]];

export const SOURCE_LABELS = Object.fromEntries(SOURCES.map((s) => [s.id, s.label])) as Record<SourceId, string>;

export const SOURCE_TRUST = Object.fromEntries(SOURCES.map((s) => [s.id, s.trust])) as Record<SourceId, 1 | 2 | 3>;
