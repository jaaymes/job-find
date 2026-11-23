/**
 * Dicionário de stacks isomórfico (RF-04, D-08).
 * Usado nos filtros de stack, na indexação das vagas e no score local de "chance".
 * Sem APIs de Node: roda no servidor e no navegador.
 */

export type StackCategory =
  | "frontend"
  | "backend"
  | "mobile"
  | "data"
  | "devops"
  | "qa"
  | "lang"
  | "other";

export type StackDef = {
  id: string;
  label: string;
  synonyms: string[];
  category: StackCategory;
  weight: number;
  implies?: string[];
  adjacent?: string[];
};

/** Incrementar ao alterar sinônimos/ids, para reindexar vagas já coletadas. */
export const STACKS_VERSION = 1;

type Opts = { weight?: number; implies?: string[]; adjacent?: string[] };

function def(
  id: string,
  label: string,
  category: StackCategory,
  synonyms: string[],
  opts: Opts = {},
): StackDef {
  const { weight, ...rest } = opts;
  return { id, label, synonyms, category, weight: weight ?? 1, ...rest };
}

const GENERIC = { weight: 0.5 };

export const STACKS: StackDef[] = [
  // Frontend
  def("react", "React", "frontend", ["react", "reactjs", "react.js", "react js"]),
  def("nextjs", "Next.js", "frontend", ["next.js", "nextjs", "next js"], { implies: ["react"] }),
  def("angular", "Angular", "frontend", ["angular", "angularjs", "angular.js"]),
  def("vue", "Vue", "frontend", ["vue", "vuejs", "vue.js", "vue js"]),
  def("nuxt", "Nuxt", "frontend", ["nuxt", "nuxt.js", "nuxtjs"], { implies: ["vue"] }),
  def("svelte", "Svelte", "frontend", ["svelte", "sveltekit"]),
  def("jquery", "jQuery", "frontend", ["jquery"]),
  def("redux", "Redux", "frontend", ["redux", "redux toolkit"]),
  def("tailwind", "Tailwind CSS", "frontend", ["tailwind", "tailwindcss", "tailwind css"]),
  def("html", "HTML", "frontend", ["html", "html5"], GENERIC),
  def("css", "CSS", "frontend", ["css", "css3", "sass", "scss"], GENERIC),
  def("wordpress", "WordPress", "other", ["wordpress"]),

  // Linguagens
  def("javascript", "JavaScript", "lang", ["javascript", "ecmascript", "es6", "js"], { adjacent: ["typescript"] }),
  def("typescript", "TypeScript", "lang", ["typescript", "ts"], { adjacent: ["javascript"] }),
  def("python", "Python", "lang", ["python"]),
  def("java", "Java", "lang", ["java"], { adjacent: ["kotlin"] }),
  def("kotlin", "Kotlin", "lang", ["kotlin"], { adjacent: ["java"] }),
  def("swift", "Swift", "lang", ["swift", "swiftui"]),
  def("csharp", "C#", "lang", ["c#", "csharp", "c sharp"], { adjacent: ["dotnet"] }),
  def("cpp", "C++", "lang", ["c++", "cpp"]),
  def("c", "C", "lang", ["linguagem c", "c language", "programação em c", "programming in c", "written in c", "plain c", "pure c"]),
  def("go", "Go", "lang", ["golang", "go"]),
  def("rust", "Rust", "lang", ["rust"]),
  def("php", "PHP", "lang", ["php"]),
  def("ruby", "Ruby", "lang", ["ruby"]),
  def("scala", "Scala", "lang", ["scala"]),
  def("dart", "Dart", "lang", ["dart"]),
  def("elixir", "Elixir", "lang", ["elixir"]),
  def("r", "R", "lang", ["linguagem r", "r language", "rstudio", "r"]),

  // Backend
  def("nodejs", "Node.js", "backend", ["node.js", "nodejs", "node js", "node"]),
  def("express", "Express", "backend", ["express.js", "expressjs"], { implies: ["nodejs"] }),
  def("nestjs", "NestJS", "backend", ["nestjs", "nest.js"], { implies: ["nodejs"] }),
  def("dotnet", ".NET", "backend", [".net", "dotnet", ".net core", ".net framework", "asp.net", "asp.net core", "asp.net mvc"], { adjacent: ["csharp"] }),
  def("spring", "Spring", "backend", ["spring boot", "springboot", "spring framework", "spring"], { implies: ["java"] }),
  def("django", "Django", "backend", ["django"], { implies: ["python"] }),
  def("flask", "Flask", "backend", ["flask"], { implies: ["python"] }),
  def("fastapi", "FastAPI", "backend", ["fastapi"], { implies: ["python"] }),
  def("laravel", "Laravel", "backend", ["laravel"], { implies: ["php"] }),
  def("rails", "Ruby on Rails", "backend", ["ruby on rails", "rails"], { implies: ["ruby"] }),
  def("graphql", "GraphQL", "backend", ["graphql"]),
  def("rest", "REST", "backend", ["rest api", "rest apis", "api rest", "apis rest", "restful", "rest"], GENERIC),
  def("grpc", "gRPC", "backend", ["grpc"]),

  // Mobile
  def("react-native", "React Native", "mobile", ["react native", "react-native", "reactnative"], { implies: ["react"] }),
  def("flutter", "Flutter", "mobile", ["flutter"], { implies: ["dart"] }),
  def("android", "Android", "mobile", ["android"]),
  def("ios", "iOS", "mobile", ["ios"]),
  def("ionic", "Ionic", "mobile", ["ionic"]),
  def("firebase", "Firebase", "other", ["firebase"]),

  // Dados
  def("sql", "SQL", "data", ["sql"], GENERIC),
  def("postgresql", "PostgreSQL", "data", ["postgresql", "postgres", "psql"]),
  def("mysql", "MySQL", "data", ["mysql", "mariadb"]),
  def("sqlserver", "SQL Server", "data", ["sql server", "sqlserver", "ms sql", "mssql"]),
  def("oracle", "Oracle", "data", ["oracle database", "oracle db", "pl/sql", "plsql", "oracle"]),
  def("mongodb", "MongoDB", "data", ["mongodb", "mongo"]),
  def("redis", "Redis", "data", ["redis"]),
  def("elasticsearch", "Elasticsearch", "data", ["elasticsearch", "elastic search"]),
  def("kafka", "Kafka", "data", ["kafka"]),
  def("rabbitmq", "RabbitMQ", "data", ["rabbitmq"]),
  def("spark", "Spark", "data", ["apache spark", "pyspark", "spark"]),
  def("airflow", "Airflow", "data", ["airflow"]),
  def("dbt", "dbt", "data", ["dbt"]),
  def("pandas", "pandas", "data", ["pandas"], { implies: ["python"] }),
  def("pytorch", "PyTorch", "data", ["pytorch"]),
  def("tensorflow", "TensorFlow", "data", ["tensorflow"]),
  def("snowflake", "Snowflake", "data", ["snowflake"]),
  def("bigquery", "BigQuery", "data", ["bigquery"]),
  def("databricks", "Databricks", "data", ["databricks"]),
  def("hadoop", "Hadoop", "data", ["hadoop"]),
  def("powerbi", "Power BI", "data", ["power bi", "powerbi"]),
  def("tableau", "Tableau", "data", ["tableau"]),

  // DevOps / cloud
  def("docker", "Docker", "devops", ["docker"]),
  def("kubernetes", "Kubernetes", "devops", ["kubernetes", "k8s"]),
  def("terraform", "Terraform", "devops", ["terraform"]),
  def("aws", "AWS", "devops", ["aws", "amazon web services"]),
  def("gcp", "Google Cloud", "devops", ["gcp", "google cloud", "google cloud platform"]),
  def("azure", "Azure", "devops", ["azure"]),
  def("jenkins", "Jenkins", "devops", ["jenkins"]),
  def("githubactions", "GitHub Actions", "devops", ["github actions"]),
  def("gitlab-ci", "GitLab CI", "devops", ["gitlab ci", "gitlab ci/cd", "gitlab-ci"]),
  def("linux", "Linux", "devops", ["linux"], GENERIC),
  def("git", "Git", "devops", ["git", "github", "gitlab", "bitbucket"], GENERIC),

  // QA
  def("selenium", "Selenium", "qa", ["selenium"]),
  def("cypress", "Cypress", "qa", ["cypress"]),
  def("playwright", "Playwright", "qa", ["playwright"]),
  def("jest", "Jest", "qa", ["jest"]),
  def("junit", "JUnit", "qa", ["junit"]),
  def("appium", "Appium", "qa", ["appium"]),
];

/**
 * Sinônimos ambíguos: casam só com a grafia exata (maiúsculas), nunca sem
 * diferenciar caixa. `title`/`body` liberam o texto puro no título/tags e no
 * corpo; `ctx` são padrões extras (título/tags e corpo) que indicam a stack
 * pelo contexto ("com Go", "Experiência: Go.", "Next 14", "Oracle" fora de
 * contexto de empregador).
 */
type CaseRule = { id: string; text: string; title: boolean; body: boolean; ctx?: string[] };

const LANG_CUE = String.raw`(?:com|with|in|em|using|usando|use|uses|usamos|write|writes|linguagem|language)`;
const LIST_CUE = String.raw`(?:or|ou|and|e)`;
const NOT_B = String.raw`(?<![\w.#+$-])`;
const NOT_A = String.raw`(?![\w#+$-])`;
/** Contextos em que uma letra/palavra ambígua capitalizada indica a linguagem. */
const bareCtx = (word: string, nouns: string[] = []): string[] => [
  String.raw`${LANG_CUE}\s+${word}${NOT_A}`,
  String.raw`\b${LIST_CUE}\s+${word}(?=\s*(?:[,.;!)]|$))`,
  String.raw`[,/(:]\s*${word}${NOT_A}(?!\s+(?:ahead|to|on|for)\b)`,
  String.raw`${NOT_B}${word}(?=\s*[,/)]|[.!](?:\s|$))`,
  String.raw`${NOT_B}${word}(?=\s+${LIST_CUE}\s+[A-Z])`,
  ...(nouns.length ? [String.raw`${NOT_B}${word}\s+(?:${nouns.join("|")})\b`] : []),
];

const CASE_RULES: CaseRule[] = [
  {
    id: "go",
    text: "Go",
    title: true,
    body: false,
    ctx: bareCtx("Go", [
      "developers?", "engineers?", "devs?", "services?", "programmers?", "code", "codebase",
      "microservices?", "backend", "fundamentals", "experience", "team", "stack",
    ]),
  },
  { id: "r", text: "R", title: true, body: false, ctx: bareCtx("R") },
  { id: "swift", text: "Swift", title: true, body: true },
  { id: "spring", text: "Spring", title: true, body: false, ctx: bareCtx("Spring") },
  { id: "spark", text: "Spark", title: true, body: true },
  { id: "rest", text: "REST", title: true, body: true },
  { id: "typescript", text: "TS", title: true, body: true },
  { id: "javascript", text: "JS", title: true, body: true },
  {
    // "Oracle" como empregador ("na Oracle", "at Oracle", "ex-Oracle") não é o banco.
    id: "oracle",
    text: "Oracle",
    title: true,
    body: false,
    ctx: [String.raw`(?<!\b(?:[Nn]a|[Aa]t|[Ff]or|[Ff]rom|[Dd]a|[Dd]e|[Pp]ela|[Pp]elo)\s+|\b[Ee]x-)${NOT_B}Oracle(?![\w#+-])`],
  },
  // "Next 14" / "Next 15": sem ".js", só com versão.
  { id: "nextjs", text: "Next", title: false, body: false, ctx: [String.raw`${NOT_B}Next\s+1\d(?![\w.])`] },
];

// ---------------------------------------------------------------------------
// Compilação (uma vez, no carregamento do módulo)
// ---------------------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const BEFORE = String.raw`(?<![\w.#+-])`;
const AFTER = String.raw`(?![\w#+-])`;
const wordSource = (s: string) => escapeRe(s.trim()).replace(/\s+/g, String.raw`\s+`);

/** Sufixos de versão colados que o lookahead padrão rejeitaria (ex.: "C++17"). */
const VERSIONED: Record<string, string[]> = {
  cpp: [String.raw`c\+\+\d{2}`],
  linux: [String.raw`linux-based`],
};

const csTexts = new Map<string, Set<string>>();
for (const r of CASE_RULES) {
  const set = csTexts.get(r.id) ?? new Set<string>();
  set.add(r.text.toLowerCase());
  csTexts.set(r.id, set);
}

type Compiled = {
  id: string;
  /** Casa sem diferenciar caixa, em qualquer parte. */
  ci: RegExp | null;
  /** Casa diferenciando caixa, em título/tags. */
  csTitle: RegExp | null;
  /** Casa diferenciando caixa, no corpo. */
  csBody: RegExp | null;
};

function boundary(sources: string[], flags: string): RegExp | null {
  if (sources.length === 0) return null;
  return new RegExp(`${BEFORE}(?:${sources.join("|")})${AFTER}`, flags);
}

function caseRegex(texts: string[], ctx: string[]): RegExp | null {
  const parts = [...(texts.length ? [`${BEFORE}(?:${texts.join("|")})${AFTER}`] : []), ...ctx];
  return parts.length ? new RegExp(parts.join("|"), "g") : null;
}

const COMPILED: Compiled[] = STACKS.map((st) => {
  const cs = csTexts.get(st.id);
  const plain = [
    ...(VERSIONED[st.id] ?? []),
    ...st.synonyms.filter((syn) => !cs?.has(syn.toLowerCase())).map(wordSource),
  ].sort((a, b) => b.length - a.length);
  const rules = CASE_RULES.filter((r) => r.id === st.id);
  const ctx = rules.flatMap((r) => r.ctx ?? []);
  return {
    id: st.id,
    ci: boundary(plain, "gi"),
    csTitle: caseRegex(rules.filter((r) => r.title).map((r) => wordSource(r.text)), ctx),
    csBody: caseRegex(rules.filter((r) => r.body).map((r) => wordSource(r.text)), ctx),
  };
});

const SYNONYM_TO_ID = new Map<string, string>();
for (const st of STACKS) {
  for (const syn of st.synonyms) SYNONYM_TO_ID.set(syn.toLowerCase(), st.id);
}
const IMPLIES = new Map(STACKS.map((s) => [s.id, s.implies ?? []]));

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** Converte uma skill/tag crua ("ReactJS", "C#") no id canônico, ou null se não for stack. */
export function normalizeSkill(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  return SYNONYM_TO_ID.get(key) ?? null;
}

type Span = { id: string; start: number; end: number };

function collect(text: string, kind: "title" | "body", out: Span[]) {
  for (const c of COMPILED) {
    const regexes = kind === "title" ? [c.ci, c.csTitle] : [c.ci, c.csBody];
    for (const re of regexes) {
      if (!re) continue;
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        // Contextos como `[,/(]\s*Go` incluem o prefixo; o span cobre só o casamento.
        out.push({ id: c.id, start: m.index, end: m.index + m[0].length });
      }
    }
  }
}

/** Descarta casamentos contidos em outro, mais longo, de outra stack ("SQL" em "SQL Server"). */
function dropContained(spans: Span[]): Set<string> {
  const ids = new Set<string>();
  for (const s of spans) {
    const contained = spans.some(
      (o) =>
        o.id !== s.id &&
        o.start <= s.start &&
        o.end >= s.end &&
        o.end - o.start > s.end - s.start,
    );
    if (!contained) ids.add(s.id);
  }
  return ids;
}

export function extractStacks(input: {
  title: string;
  tags?: string[];
  body?: string;
}): { id: string; inTitle: boolean }[] {
  const titleSpans: Span[] = [];
  collect(input.title, "title", titleSpans);
  const found = new Map<string, boolean>(); // id -> inTitle
  for (const id of dropContained(titleSpans)) found.set(id, true);

  const otherSpans: Span[] = [];
  // Tags: cada uma é analisada isolada (tem as mesmas permissões do título).
  for (const tag of input.tags ?? []) {
    const id = normalizeSkill(tag);
    if (id && !found.has(id)) found.set(id, false);
    const spans: Span[] = [];
    collect(tag, "title", spans);
    for (const tid of dropContained(spans)) if (!found.has(tid)) found.set(tid, false);
  }
  if (input.body) collect(input.body, "body", otherSpans);
  for (const id of dropContained(otherSpans)) if (!found.has(id)) found.set(id, false);

  // implies (transitivo), herdando inTitle de quem implicou.
  const queue = [...found.entries()];
  while (queue.length) {
    const [id, inTitle] = queue.pop()!;
    for (const implied of IMPLIES.get(id) ?? []) {
      const prev = found.get(implied);
      if (prev === undefined || (inTitle && !prev)) {
        found.set(implied, (prev ?? false) || inTitle);
        queue.push([implied, inTitle]);
      }
    }
  }
  return [...found].map(([id, inTitle]) => ({ id, inTitle }));
}
