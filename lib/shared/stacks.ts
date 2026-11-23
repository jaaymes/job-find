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
  def("javascript", "JavaScript", "lang", ["javascript", "ecmascript", "es6"], { adjacent: ["typescript"] }),
  def("typescript", "TypeScript", "lang", ["typescript"], { adjacent: ["javascript"] }),
  def("python", "Python", "lang", ["python"]),
  def("java", "Java", "lang", ["java"], { adjacent: ["kotlin"] }),
  def("kotlin", "Kotlin", "lang", ["kotlin"], { adjacent: ["java"] }),
  def("swift", "Swift", "lang", ["swift", "swiftui"]),
  def("csharp", "C#", "lang", ["c#", "csharp", "c sharp"], { adjacent: ["dotnet"] }),
  def("cpp", "C++", "lang", ["c++", "cpp"]),
  def("c", "C", "lang", ["linguagem c", "c language"]),
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
 * Sinônimos ambíguos: casam só com a grafia exata (maiúsculas) e, quando
 * `body` é falso, só no título/tags — ou no corpo em contextos que indicam
 * linguagem (ex.: "com Go", "Rust, Go"). Nunca casam sem diferenciar caixa.
 */
type CaseRule = { id: string; text: string; body: boolean; bodyContext?: string[] };

const CASE_RULES: CaseRule[] = [
  {
    id: "go",
    text: "Go",
    body: false,
    bodyContext: [
      String.raw`(?:com|with|in|em|using|usando|linguagem|language)\s+Go(?![\w#+$-])`,
      String.raw`\b(?:or|ou|and|e)\s+Go(?=\s*(?:[,.;)]|$))`,
      String.raw`[,/(]\s*Go(?![\w#+$-])`,
      String.raw`(?<![\w.#+-])Go(?=\s*[,/)])`,
      String.raw`(?<![\w.#+-])Go(?=\s+(?:ou|or|and|e)\s+[A-Z])`,
    ],
  },
  {
    id: "r",
    text: "R",
    body: false,
    bodyContext: [
      String.raw`(?:com|with|in|em|using|usando|linguagem|language)\s+R(?![\w#+$-])`,
      String.raw`(?<![\w.#+$-])R(?=\s*[,/)]|\s+(?:ou|or|and|e)\s+[A-Z])`,
    ],
  },
  { id: "swift", text: "Swift", body: true },
  { id: "spring", text: "Spring", body: true },
  { id: "spark", text: "Spark", body: true },
  { id: "oracle", text: "Oracle", body: true },
  { id: "rest", text: "REST", body: true },
];

// ---------------------------------------------------------------------------
// Compilação (uma vez, no carregamento do módulo)
// ---------------------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const BEFORE = String.raw`(?<![\w.#+-])`;
const AFTER = String.raw`(?![\w#+-])`;
const wordSource = (s: string) => escapeRe(s.trim()).replace(/\s+/g, String.raw`\s+`);

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
  /** Casa diferenciando caixa, em título/tags (e corpo se `bodyAll`). */
  csTitle: RegExp | null;
  csBody: RegExp | null;
};

function boundary(sources: string[], flags: string): RegExp | null {
  if (sources.length === 0) return null;
  return new RegExp(`${BEFORE}(?:${sources.join("|")})${AFTER}`, flags);
}

const COMPILED: Compiled[] = STACKS.map((st) => {
  const cs = csTexts.get(st.id);
  const plain = st.synonyms
    .filter((syn) => !cs?.has(syn.toLowerCase()))
    .sort((a, b) => b.length - a.length)
    .map(wordSource);
  const rules = CASE_RULES.filter((r) => r.id === st.id);
  const csAll = rules.filter((r) => r.body).map((r) => wordSource(r.text));
  const csTitleOnly = rules.map((r) => wordSource(r.text));
  const ctx = rules.flatMap((r) => r.bodyContext ?? []);
  return {
    id: st.id,
    ci: boundary(plain, "gi"),
    csTitle: boundary(csTitleOnly, "g"),
    csBody: csAll.length || ctx.length
      ? new RegExp(
          [...(csAll.length ? [`${BEFORE}(?:${csAll.join("|")})${AFTER}`] : []), ...ctx].join("|"),
          "g",
        )
      : null,
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
