import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AiError } from "@/lib/client/ai/errors";
import { generateStructured, type GenerateArgs, type TokenUsage } from "@/lib/client/ai/generate";
import { CV_TAILOR_V1, pickLanguage } from "@/lib/client/ai/prompts/cv.tailor.v1";
import type { AiSettings } from "@/lib/client/ai/settings";
import { assembleCv } from "@/lib/client/cv/assemble";
import type { CvLang } from "@/lib/client/cv/period";
import { toPromptFeedback, validateTailored, type Violation } from "@/lib/client/cv/validate";
import { Profile } from "@/lib/shared/schemas/profile";
import type { TailoredDocs } from "@/lib/shared/schemas/tailored";
import type { JobDetail } from "@/lib/shared/types/job";
import { z } from "@/lib/shared/zod";

/** Limite de tempo do critério de aceitação (p95 por par). */
export const P95_LIMIT_MS = 60_000;

const Nullable = <T extends z.ZodType>(t: T) => t.nullable();

/** Espelha `JobDetail`: a anotação de tipo faz o compilador acusar qualquer divergência. */
export const EvalJob: z.ZodType<JobDetail> = z.object({
  id: z.number(),
  title: z.string(),
  company: z.string(),
  companyLogoUrl: Nullable(z.string()),
  summary: z.string(),
  country: Nullable(z.string()),
  city: Nullable(z.string()),
  origin: z.enum(["national", "international", "unknown"]),
  acceptsBrazil: Nullable(z.boolean()),
  workMode: z.enum(["remote", "hybrid", "onsite", "unknown"]),
  seniority: Nullable(z.enum(["intern", "junior", "mid", "senior", "lead"])),
  language: z.string(),
  stacks: z.array(z.string()),
  sources: z.array(
    z.enum(["himalayas", "greenhouse", "ashby", "lever", "jobicy", "github", "wwr", "remoteok", "hn", "smartrecruiters"]),
  ),
  salaryMin: Nullable(z.number()),
  salaryMax: Nullable(z.number()),
  salaryCurrency: Nullable(z.string()),
  salaryPeriod: Nullable(z.enum(["hour", "month", "year"])),
  publishedAt: z.string(),
  urlCanonical: z.string(),
  applyUrl: Nullable(z.string()),
  descriptionHtml: z.string(),
  attribution: z.array(
    z.object({
      source: z.enum(["himalayas", "greenhouse", "ashby", "lever", "jobicy", "github", "wwr", "remoteok", "hn", "smartrecruiters"]),
      label: z.string(),
      url: z.string(),
      dofollow: z.boolean(),
    }),
  ),
});

export type Pair = { id: string; profile: Profile; job: JobDetail };

/** Lê `NN.json` do diretório, valida perfil e vaga com os schemas do app e devolve os pares em ordem. */
export async function loadPairs(dir: string): Promise<Pair[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{2}\.json$/.test(f)).sort();
  if (files.length === 0) throw new Error(`nenhum par NN.json em ${dir}`);
  const pairs: Pair[] = [];
  for (const f of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(dir, f), "utf8"));
    } catch {
      throw new Error(`${f}: JSON ilegível`);
    }
    const parsed = z.object({ profile: Profile, job: EvalJob }).safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(raiz)"}: ${i.message}`);
      throw new Error(`${f}: par inválido\n- ${issues.join("\n- ")}`);
    }
    pairs.push({ id: f.replace(/\.json$/, ""), ...parsed.data });
  }
  return pairs;
}

export type PairResult = {
  id: string;
  lang: CvLang;
  /** A resposta final passou no JSON e no schema (nas 2 chamadas no máximo). */
  validJson: boolean;
  /** Chamadas ao modelo; `null` quando a falha não vem da validação (rede, chave, etc.). */
  calls: number | null;
  /** Violações do validador no resultado final (depois da retentativa): são as "persistentes". */
  violations: Violation[];
  ms: number;
  usage: TokenUsage | null;
  /** Código do erro (nunca a mensagem, que poderia carregar dados do provedor). */
  error: string | null;
  /** Falha de rede reconhecível (sem status HTTP). */
  network?: boolean;
  /** Documentos finais devolvidos pelo modelo (para `--out`); `null` quando falhou. */
  docs?: TailoredDocs | null;
};

/** Erros que se repetiriam em todos os pares: a avaliação para no primeiro (não gasta chamadas à toa). */
const ABORT_CODES = new Set(["invalid_key", "no_credit", "budget"]);

/** Motivo para interromper os pares restantes, ou `null` para seguir. */
export function abortReason(r: PairResult): string | null {
  if (r.error && ABORT_CODES.has(r.error)) return r.error;
  if (r.network) return "rede";
  return null;
}

export type Aborted = { after: string; reason: string; skipped: number };

export type EvaluateOpts = {
  settings: AiSettings;
  resolveModel?: GenerateArgs<TailoredDocs>["resolveModel"];
  /** Relógio em ms; injetável para testes. */
  now?: () => number;
  includeLetter?: boolean;
};

/** Roda `CV_TAILOR_V1` num par, no mesmo formato de chamada de `generateDocs`, e mede o resultado. */
export async function evaluatePair(pair: Pair, opts: EvaluateOpts): Promise<PairResult> {
  const now = opts.now ?? (() => performance.now());
  const lang = pickLanguage(pair.job);
  const includeLetter = opts.includeLetter ?? true;
  const started = now();
  try {
    const r = await generateStructured({
      task: "cv",
      settings: opts.settings,
      system: CV_TAILOR_V1.system,
      prompt: CV_TAILOR_V1.buildUser({ profile: pair.profile, job: pair.job, lang, withCoverLetter: includeLetter }),
      schema: CV_TAILOR_V1.schema,
      maxOutputTokens: CV_TAILOR_V1.maxOutputTokens,
      temperature: CV_TAILOR_V1.temperature,
      validate: (d, ctx) => (ctx.last ? [] : toPromptFeedback(validateTailored(pair.profile, d, pair.job))),
      resolveModel: opts.resolveModel,
    });
    return {
      id: pair.id,
      lang,
      validJson: true,
      calls: r.calls,
      violations: validateTailored(pair.profile, r.data, pair.job),
      ms: Math.round(now() - started),
      usage: r.usage,
      error: null,
      docs: r.data,
    };
  } catch (e) {
    const code = e instanceof AiError ? e.code : "unexpected";
    // `mapProviderError`: sem status HTTP (rede, DNS, conexão recusada) vira `unavailable` sem `meta.status`. O fim
    // anormal do stream (`meta.finishReason`, mesmo `undefined`) é do par, não da rede: não interrompe.
    const meta = e instanceof AiError ? (e.meta ?? {}) : {};
    const network = code === "unavailable" && !("status" in meta) && !("finishReason" in meta);
    return {
      id: pair.id,
      lang,
      validJson: false,
      calls: code === "invalid_output" ? 2 : null,
      violations: [],
      ms: Math.round(now() - started),
      usage: null,
      error: code,
      network,
      docs: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Texto gerado (--out)
// ---------------------------------------------------------------------------

/** CV montado como no app (`assembleCv`), em texto puro; trechos que o validador marcou levam `[REVISAR]`. */
export function cvText(pair: Pair, docs: TailoredDocs, lang: CvLang, violations: Violation[]): string {
  const cv = assembleCv(pair.profile, docs, lang, { violations });
  const mark = (flagged: boolean) => (flagged ? "[REVISAR] " : "");
  const out = [cv.name, `${mark(cv.flags.headline.flagged)}${cv.headline}`, cv.contactLine, "", "Resumo", `${mark(cv.flags.summary.flagged)}${cv.summary}`, "", "Experiência"];
  for (const x of cv.experiences) {
    out.push(`${x.role} – ${x.company}${x.occurrence > 0 ? " [REPETIDA]" : ""}`, x.period);
    for (const b of x.bullets) out.push(`- ${mark(b.flagged)}${b.text}`);
    out.push("");
  }
  out.push("Competências", cv.skills.map((sk, i) => `${mark(cv.flags.skills[i]?.flagged ?? false)}${sk}`).join(", "));
  if (cv.education.length > 0) out.push("", "Formação", ...cv.education);
  const flagged = violations.map((v) => `- ${v.kind} "${v.text}" (${v.where.part === "letter" ? "carta" : "CV"})`);
  if (flagged.length > 0) out.push("", "Violações:", ...flagged);
  return `${out.join("\n")}\n`;
}

/** Grava `<id>-cv.txt` e `<id>-carta.txt` de cada par que gerou documentos. Devolve os arquivos escritos. */
export async function writeOutputs(dir: string, pairs: Pair[], results: PairResult[]): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const r of results) {
    const pair = pairs.find((p) => p.id === r.id);
    if (!pair || !r.docs) continue;
    const cvFile = join(dir, `${r.id}-cv.txt`);
    await writeFile(cvFile, cvText(pair, r.docs, r.lang, r.violations), "utf8");
    written.push(cvFile);
    if (r.docs.coverLetter !== null) {
      const letterFile = join(dir, `${r.id}-carta.txt`);
      const letterViolations = r.violations.filter((v) => v.where.part === "letter");
      const head = letterViolations.length > 0 ? "[REVISAR] " : "";
      await writeFile(letterFile, `${head}${r.docs.coverLetter}\n`, "utf8");
      written.push(letterFile);
    }
  }
  return written;
}

// ---------------------------------------------------------------------------
// Estatística, custo e tabela
// ---------------------------------------------------------------------------

/** Percentil pelo método do posto mais próximo; `NaN` para lista vazia. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1];
}

/** USD por milhão de tokens (como `ModelInfo.priceIn/priceOut`). */
export type Price = { priceIn: number; priceOut: number };

/** Custo em USD, ou `null` sem preço conhecido ou sem tokens informados (nunca inventa preço). */
export function costUsd(usage: TokenUsage | null, price: Price | null): number | null {
  if (!usage || !price || usage.inputTokens === undefined || usage.outputTokens === undefined) return null;
  return (usage.inputTokens * price.priceIn + usage.outputTokens * price.priceOut) / 1e6;
}

export function formatCost(v: number | null): string {
  return v === null ? "n/d" : `US$ ${v.toFixed(v < 0.01 ? 5 : 4)}`;
}

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

function formatTokens(u: TokenUsage | null): string {
  return u && u.inputTokens !== undefined && u.outputTokens !== undefined ? `${u.inputTokens}/${u.outputTokens}` : "n/d";
}

export type Summary = {
  pairs: number;
  persistentTotal: number;
  invalidJson: number;
  p50Ms: number;
  p95Ms: number;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
  failures: string[];
  pass: boolean;
};

export function summarize(results: PairResult[], price: Price | null, limitMs = P95_LIMIT_MS, aborted: Aborted | null = null): Summary {
  const times = results.map((r) => r.ms);
  const persistentTotal = results.reduce((n, r) => n + r.violations.length, 0);
  const invalidJson = results.filter((r) => !r.validJson).length;
  const costs = results.map((r) => costUsd(r.usage, price));
  const totalCost = price && costs.length > 0 && costs.every((c) => c !== null) ? costs.reduce<number>((a, c) => a + (c ?? 0), 0) : null;
  const p95Ms = percentile(times, 95);
  const failures: string[] = [];
  if (persistentTotal > 0) failures.push(`${persistentTotal} violação(ões) persistente(s)`);
  if (invalidJson > 0) failures.push(`${invalidJson} par(es) sem JSON válido`);
  if (Number.isNaN(p95Ms) || p95Ms > limitMs) failures.push(`p95 acima de ${limitMs / 1000} s`);
  if (aborted) failures.push(`interrompida no par ${aborted.after} (${aborted.reason}); ${aborted.skipped} par(es) não rodaram`);
  return {
    pairs: results.length,
    persistentTotal,
    invalidJson,
    p50Ms: percentile(times, 50),
    p95Ms,
    costUsd: totalCost,
    inputTokens: results.reduce((n, r) => n + (r.usage?.inputTokens ?? 0), 0),
    outputTokens: results.reduce((n, r) => n + (r.usage?.outputTokens ?? 0), 0),
    failures,
    pass: failures.length === 0,
  };
}

/** Tabela em texto monoespaçado, mais o resumo e o detalhe das violações. */
export function renderReport(
  results: PairResult[],
  price: Price | null,
  summary = summarize(results, price),
  aborted: Aborted | null = null,
): string {
  const head = ["Par", "Idioma", "JSON válido", "Chamadas", "Violações", "Tempo", "Tokens (ent/saí)", "Custo"];
  const rows = results.map((r) => [
    r.id,
    r.lang,
    r.validJson ? "sim" : "não",
    r.calls === null ? "n/d" : String(r.calls),
    r.validJson ? String(r.violations.length) : "n/d",
    formatMs(r.ms),
    formatTokens(r.usage),
    formatCost(costUsd(r.usage, price)),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  const out = [line(head), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line), ""];
  out.push(
    `Violações persistentes (total): ${summary.persistentTotal}`,
    `Pares sem JSON válido: ${summary.invalidJson}`,
    `Tempo p50 / p95: ${formatMs(summary.p50Ms)} / ${formatMs(summary.p95Ms)}`,
    `Tokens (ent/saí): ${summary.inputTokens}/${summary.outputTokens}`,
    `Custo total: ${formatCost(summary.costUsd)}${price ? "" : " (sem preço conhecido para o modelo)"}`,
    `Resultado: ${summary.pass ? "APROVADO" : `REPROVADO (${summary.failures.join("; ")})`}`,
  );
  if (aborted) {
    out.push(`Avaliação interrompida no par ${aborted.after} por ${aborted.reason}: ${aborted.skipped} par(es) restante(s) não rodaram.`);
  }
  const details = results.flatMap((r) =>
    r.violations.map((v) => `  par ${r.id}: ${v.kind} "${v.text}"`).concat(r.error ? [`  par ${r.id}: erro ${r.error}`] : []),
  );
  if (details.length > 0) out.push("", "Detalhe:", ...details);
  return out.join("\n");
}
