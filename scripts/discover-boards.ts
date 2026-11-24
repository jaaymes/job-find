/**
 * Descoberta offline de boards públicos de Greenhouse, Ashby, Lever e SmartRecruiters com vagas de tecnologia e/ou Brasil (D-03).
 *
 *   pnpm tsx scripts/discover-boards.ts --ats greenhouse|ashby|lever|smartrecruiters
 *   pnpm tsx scripts/discover-boards.ts --ats ashby --skip-commoncrawl     (sem o Common Crawl)
 *   pnpm tsx scripts/discover-boards.ts --ats lever --with-curated          (testa também os boards já curados)
 *
 * Origem dos slugs: lista de empresas do repositório ConorsCode/open-jobs-data, empresas da YC que estão
 * contratando (slug derivado do nome e do site) e URLs de boards no Common Crawl. Cada slug é testado pela API do
 * próprio conector (`createSafeFetch` + `normalize`, no máximo 4 simultâneos, com backoff em 429/5xx).
 *
 * Saída em `scripts/discover-boards/out/` (ignorada pelo git): `candidates-<ats>.json` (ordenado por `br` e depois
 * `tech`), `summary-<ats>.json` e o cache incremental `tested-<ats>.jsonl`. Nada é gravado em `lib/`: as listas
 * aprovadas entram à mão em `lib/server/sources/boards/<ats>.ts`.
 *
 * SmartRecruiters: os ids diferenciam maiúsculas e minúsculas, então só valem o open-jobs-data (plataforma `smartrecruiters`) e a
 * lista `SMARTRECRUITERS_EXTRA` (palpites de multinacionais com operação no Brasil, conferidos em 2026-11-24); YC e Common Crawl
 * não entram. O teste usa só a lista de vagas do Brasil (`country=br`, 1ª página) com os itens de função `information_technology`,
 * sem buscar o detalhe de cada vaga: o filtro RN-01 olha o título e o departamento.
 *
 * Ferramenta offline: as origens de slugs usam fetch direto; só o teste dos boards passa pelo fetch seguro.
 */
import "./discover-boards/server-only-shim";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Connector, SafeFetch } from "@/lib/server/sources/types";
import type { BoardVerdict } from "./discover-boards/validate";

// Depois do shim: `validate` importa módulos de `lib/server` que carregam `server-only`.
const { acceptBoard, techOnly } = await import("./discover-boards/validate");

const ATS_LIST = ["greenhouse", "ashby", "lever", "smartrecruiters"] as const;
type Ats = (typeof ATS_LIST)[number];

const CONCURRENCY = 4;
const PACE_MS = 150;
const MAX_ATTEMPTS = 4;
const DEFAULT_CC_INDEX = "CC-MAIN-2026-47";
const CC_MAX_PAGES = 6;
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "discover-boards/out");
const UA = "job-find-discover-boards/1.0 (ferramenta offline; baixa concorrencia)";

const OPEN_JOBS_COMPANIES = "https://raw.githubusercontent.com/ConorsCode/open-jobs-data/main/companies.json";
const YC_HIRING = "https://yc-oss.github.io/api/companies/hiring.json";
const CC_HOSTS: Record<Ats, string[]> = {
  greenhouse: ["job-boards.greenhouse.io", "boards.greenhouse.io"],
  ashby: ["jobs.ashbyhq.com"],
  lever: ["jobs.lever.co"],
  smartrecruiters: [],
};

/** Palpites de ids SmartRecruiters (multinacionais com operação no Brasil) que existem na API, checados em 2026-11-24. */
const SMARTRECRUITERS_EXTRA = ["Continental", "Freshworks", "Gupy", "Endava", "ServiceNow", "Wise", "Visa", "Equinox"];

type Source = "open-jobs-data" | "yc" | "commoncrawl" | "curated" | "guess";
type Result = BoardVerdict & {
  slug: string;
  boardName: string | null;
  total: number;
  sources: Source[];
  curated: boolean;
};
type Tested = { slug: string; status: "ok" | "not-found" | "error"; error?: string; result?: Result };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// --- origens de slugs -----------------------------------------------------------------------------------

async function plainFetch(url: string, attempts = MAX_ATTEMPTS): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60_000) });
      if (res.ok) return res;
      last = new Error(`HTTP ${res.status}`);
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      last = err;
    }
    await sleep(1500 * 2 ** i);
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function fromOpenJobsData(ats: Ats): Promise<string[]> {
  const data = (await (await plainFetch(OPEN_JOBS_COMPANIES)).json()) as Array<{ platform?: string; slug?: string }>;
  return data.filter((c) => c.platform === ats && typeof c.slug === "string").map((c) => (ats === "smartrecruiters" ? c.slug! : c.slug!.toLowerCase()));
}

function slugVariants(name: string, website: string | null): string[] {
  const out = new Set<string>();
  const plain = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (plain) {
    out.add(plain.replace(/ /g, ""));
    out.add(plain.replace(/ /g, "-"));
  }
  if (website) {
    try {
      const labels = new URL(website).hostname.toLowerCase().replace(/^www\./, "").split(".");
      const label = labels.length >= 2 ? labels[labels.length - 2]! : labels[0]!;
      if (/^[a-z0-9-]+$/.test(label)) out.add(label);
    } catch {
      // site inválido: só o nome vale
    }
  }
  return [...out].filter((s) => s.length >= 2 && s.length <= 40);
}

async function fromYc(): Promise<string[]> {
  const data = (await (await plainFetch(YC_HIRING)).json()) as Array<{ name?: string; website?: string; slug?: string }>;
  const out = new Set<string>();
  for (const c of data) {
    if (!c.name) continue;
    for (const s of slugVariants(c.name, c.website ?? null)) out.add(s);
    if (c.slug) out.add(c.slug.toLowerCase());
  }
  return [...out];
}

async function resolveCcIndex(preferred: string, notes: string[]): Promise<string | null> {
  try {
    const info = (await (await plainFetch("https://index.commoncrawl.org/collinfo.json", 3)).json()) as Array<{ id: string }>;
    if (info.some((c) => c.id === preferred)) return preferred;
    const latest = info[0]?.id ?? null;
    notes.push(`Índice ${preferred} não existe; usado o mais recente (${latest}).`);
    return latest;
  } catch (err) {
    notes.push(`Common Crawl indisponível ao listar índices (${(err as Error).message}).`);
    return null;
  }
}

async function fromCommonCrawl(ats: Ats, index: string, notes: string[]): Promise<string[]> {
  const slugs = new Set<string>();
  for (const host of CC_HOSTS[ats]) {
    for (let page = 0; page < CC_MAX_PAGES; page++) {
      const url = `https://index.commoncrawl.org/${index}-index?url=${host}/*&output=json&fl=url&page=${page}`;
      let text: string;
      try {
        text = await (await plainFetch(url, 5)).text();
      } catch (err) {
        notes.push(`Common Crawl ${host} página ${page}: ${(err as Error).message}`);
        break;
      }
      const lines = text.split("\n").filter(Boolean);
      if (lines.length === 0) break;
      for (const line of lines) {
        try {
          const u = new URL((JSON.parse(line) as { url: string }).url);
          const slug = u.pathname.split("/").filter(Boolean)[0]?.toLowerCase();
          if (slug && /^[a-z0-9][a-z0-9_.-]{1,60}$/.test(slug)) slugs.add(slug);
        } catch {
          // linha inválida
        }
      }
      await sleep(1000);
    }
  }
  return [...slugs];
}

// --- teste de um slug -----------------------------------------------------------------------------------

type Adapter = {
  connector: Connector;
  curated: readonly string[];
  url(slug: string): string;
  jobs(body: unknown): unknown[] | null;
  boardName(jobs: unknown[]): string | null;
  /** Adapta a vaga crua da lista ao formato que o `normalize` do conector espera (detalhe ausente na lista). */
  prepare?(slug: string, job: object): object;
};

async function loadAdapter(ats: Ats): Promise<Adapter> {
  if (ats === "greenhouse") {
    const m = await import("@/lib/server/sources/greenhouse");
    return {
      connector: m.greenhouse,
      curated: m.GREENHOUSE_BOARDS,
      url: (s) => `https://${m.GREENHOUSE_HOST}/v1/boards/${s}/jobs?content=true`,
      jobs: (b) => (Array.isArray((b as { jobs?: unknown })?.jobs) ? (b as { jobs: unknown[] }).jobs : null),
      boardName: (jobs) => {
        const first = jobs.find((j) => (j as { company_name?: unknown })?.company_name) as { company_name?: string } | undefined;
        return first?.company_name?.trim() || null;
      },
    };
  }
  if (ats === "ashby") {
    const m = await import("@/lib/server/sources/ashby");
    return {
      connector: m.ashby,
      curated: m.ASHBY_BOARDS,
      url: (s) => `https://${m.ASHBY_HOST}/posting-api/job-board/${s}?includeCompensation=true`,
      jobs: (b) => (Array.isArray((b as { jobs?: unknown })?.jobs) ? (b as { jobs: unknown[] }).jobs : null),
      boardName: () => null,
    };
  }
  if (ats === "smartrecruiters") {
    const m = await import("@/lib/server/sources/smartrecruiters");
    return {
      connector: m.smartrecruiters,
      curated: m.SMARTRECRUITERS_BOARDS,
      url: (s) => `https://${m.SMARTRECRUITERS_HOST}/v1/companies/${s}/postings?limit=100&offset=0&country=br`,
      jobs: (b) => {
        const content = (b as { content?: unknown })?.content;
        if (!Array.isArray(content)) return null;
        return content.filter((j) => (j as { function?: { id?: string } })?.function?.id === "information_technology");
      },
      boardName: (jobs) => {
        const first = jobs.find((j) => (j as { company?: { name?: unknown } })?.company?.name) as { company?: { name?: string } } | undefined;
        return first?.company?.name?.trim() || null;
      },
      prepare: (slug, job) => ({
        ...job,
        board: slug,
        detail: { postingUrl: `https://jobs.smartrecruiters.com/${slug}/${(job as { id?: string }).id}`, jobAd: { sections: {} } },
      }),
    };
  }
  const m = await import("@/lib/server/sources/lever");
  return {
    connector: m.lever,
    curated: m.LEVER_BOARDS,
    url: (s) => `https://${m.LEVER_HOST}/v0/postings/${s}?mode=json`,
    jobs: (b) => (Array.isArray(b) ? b : null),
    boardName: () => null,
  };
}

async function testSlug(adapter: Adapter, safeFetch: SafeFetch, slug: string): Promise<Tested> {
  let lastError = "";
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await safeFetch(adapter.url(slug));
      const jobs = adapter.jobs(await res.json());
      if (!jobs) return { slug, status: "error", error: "resposta fora do formato esperado" };
      // `normalize` só valida o formato; o filtro tech RN-01 (`isTechJob`) entra aqui, e `total` segue sendo o nº de vagas cruas.
      const normalized = jobs.map((job) =>
        techOnly(adapter.connector.normalize(
          typeof job === "object" && job !== null ? (adapter.prepare?.(slug, job) ?? { ...(job as object), board: slug }) : job,
        )),
      );
      const boardName = adapter.boardName(jobs);
      const verdict = acceptBoard({ slug, boardName, total: jobs.length, normalized });
      return {
        slug,
        status: "ok",
        result: { ...verdict, slug, boardName, total: jobs.length, sources: [], curated: false },
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (/HTTP 404/.test(lastError)) return { slug, status: "not-found" };
      if (!/HTTP (429|5\d\d)|timeout|fetch failed|ECONN|ETIMEDOUT/i.test(lastError)) break;
      await sleep(1000 * 2 ** attempt);
    }
  }
  return { slug, status: "error", error: lastError };
}

async function runPool<T>(items: T[], worker: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await worker(items[i]!, i);
        await sleep(PACE_MS);
      }
    }),
  );
}

// --- principal ------------------------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    options: {
      ats: { type: "string" },
      "skip-commoncrawl": { type: "boolean", default: false },
      "with-curated": { type: "boolean", default: false },
      "cc-index": { type: "string", default: DEFAULT_CC_INDEX },
      limit: { type: "string" },
    },
  });
  const ats = values.ats as Ats;
  if (!ATS_LIST.includes(ats)) {
    console.error("Uso: pnpm tsx scripts/discover-boards.ts --ats greenhouse|ashby|lever|smartrecruiters [--skip-commoncrawl] [--with-curated]");
    process.exit(2);
  }

  const { createSafeFetch } = await import("@/lib/server/sources/http");
  const adapter = await loadAdapter(ats);
  const safeFetch = createSafeFetch(adapter.connector.allowedHosts, { timeoutMs: 30_000 });
  mkdirSync(OUT_DIR, { recursive: true });

  const notes: string[] = [];
  const sr = ats === "smartrecruiters";
  const bySlug = new Map<string, Set<Source>>();
  const add = (slugs: string[], source: Source) => {
    for (const s of slugs) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(s) || (!sr && s !== s.toLowerCase())) continue;
      (bySlug.get(s) ?? bySlug.set(s, new Set()).get(s)!).add(source);
    }
  };

  const fromList = await fromOpenJobsData(ats).catch((e: Error) => (notes.push(`open-jobs-data: ${e.message}`), []));
  add(fromList, "open-jobs-data");
  const yc = sr ? [] : await fromYc().catch((e: Error) => (notes.push(`yc: ${e.message}`), []));
  add(yc, "yc");
  let ccCount = 0;
  let ccIndexUsed: string | null = null;
  if (sr) {
    add(SMARTRECRUITERS_EXTRA, "guess");
    notes.push("SmartRecruiters: sem YC nem Common Crawl (ids diferenciam maiúsculas).");
  } else if (!values["skip-commoncrawl"]) {
    ccIndexUsed = await resolveCcIndex(values["cc-index"]!, notes);
    if (ccIndexUsed) {
      const cc = await fromCommonCrawl(ats, ccIndexUsed, notes);
      ccCount = cc.length;
      add(cc, "commoncrawl");
    }
  } else {
    notes.push("Common Crawl pulado (--skip-commoncrawl).");
  }

  const curated = new Set(adapter.curated);
  if (values["with-curated"]) add([...curated], "curated");
  let slugs = [...bySlug.keys()].filter((s) => values["with-curated"] || !curated.has(s));
  if (values.limit) slugs = slugs.slice(0, Number(values.limit));

  const cachePath = resolve(OUT_DIR, `tested-${ats}.jsonl`);
  const cache = new Map<string, Tested>();
  if (existsSync(cachePath)) {
    for (const line of readFileSync(cachePath, "utf8").split("\n").filter(Boolean)) {
      const t = JSON.parse(line) as Tested;
      if (t.status !== "error") cache.set(t.slug, t);
    }
  }
  const todo = slugs.filter((s) => !cache.has(s));
  console.error(`[${ats}] ${slugs.length} slugs (${cache.size} em cache, ${todo.length} a testar)`);

  let done = 0;
  await runPool(todo, async (slug) => {
    const t = await testSlug(adapter, safeFetch, slug);
    cache.set(slug, t);
    appendFileSync(cachePath, `${JSON.stringify(t)}\n`);
    if (++done % 100 === 0) console.error(`[${ats}] ${done}/${todo.length}`);
  });

  const all = slugs.map((s) => cache.get(s)!).filter(Boolean);
  const results: Result[] = all
    .filter((t) => t.status === "ok" && t.result)
    .map((t) => ({ ...t.result!, sources: [...(bySlug.get(t.slug) ?? [])], curated: curated.has(t.slug) }))
    .sort((a, b) => b.br - a.br || b.tech - a.tech || a.slug.localeCompare(b.slug));

  const rejected: Record<string, number> = {};
  for (const r of results) if (!r.accept) rejected[r.reason ?? "?"] = (rejected[r.reason ?? "?"] ?? 0) + 1;
  const summary = {
    ats,
    generatedAt: new Date().toISOString(),
    commonCrawlIndex: ccIndexUsed,
    slugsBySource: { "open-jobs-data": fromList.length, yc: yc.length, commoncrawl: ccCount },
    tested: slugs.length,
    found: results.length,
    notFound: all.filter((t) => t.status === "not-found").length,
    errors: all.filter((t) => t.status === "error").map((t) => ({ slug: t.slug, error: t.error })),
    accepted: results.filter((r) => r.accept).length,
    rejectedByReason: rejected,
    notes,
  };
  writeFileSync(resolve(OUT_DIR, `candidates-${ats}.json`), `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync(resolve(OUT_DIR, `summary-${ats}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  console.error(`[${ats}] ${summary.accepted} aceitos de ${summary.found} com board; ${summary.notFound} inexistentes; ${summary.errors.length} com erro.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
