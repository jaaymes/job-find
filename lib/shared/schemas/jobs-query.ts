import { z } from "zod";
import { normalizeSkill } from "@/lib/shared/stacks";
import type { SourceId } from "@/lib/shared/types/job";

const SOURCE_IDS = [
  "himalayas",
  "greenhouse",
  "ashby",
  "lever",
  "jobicy",
  "github",
  "wwr",
  "remoteok",
  "hn",
  "smartrecruiters",
] as const satisfies readonly SourceId[];

/**
 * Nomes desconhecidos são descartados. Se nenhum sobra, fica `[]` (não `undefined`): a consulta
 * trata a lista vazia como "nenhuma vaga casa", em vez de ignorar o filtro e devolver tudo.
 */
const stacksField = z
  .array(z.string())
  .max(10)
  .transform((list) => {
    const out = new Set<string>();
    for (const raw of list) {
      const id = normalizeSkill(raw);
      if (id) out.add(id);
    }
    return [...out];
  });

export const jobsQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  stacks: stacksField.optional(),
  stacksMode: z.enum(["any", "all"]).default("any"),
  origin: z.enum(["national", "international"]).optional(),
  acceptsBrazil: z.boolean().optional(),
  workMode: z.enum(["remote", "hybrid", "onsite"]).optional(),
  seniority: z.array(z.enum(["intern", "junior", "mid", "senior", "lead"])).optional(),
  lang: z.enum(["pt", "en", "es"]).optional(),
  since: z.enum(["24h", "7d", "30d"]).optional(),
  source: z.array(z.enum(SOURCE_IDS)).optional(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(90).default(30),
});

export type JobsQuery = z.infer<typeof jobsQuerySchema>;

export type ParseJobsQueryResult =
  | { ok: true; value: JobsQuery }
  | { ok: false; error: { code: "invalid_query"; message: string } };

const LIST_KEYS = ["stacks", "seniority", "source"] as const;

/** Lê o valor (ou lista, com vírgula e chaves repetidas) e ignora strings vazias. */
function readList(sp: URLSearchParams, key: string): string[] | undefined {
  const items = sp
    .getAll(key)
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function readScalar(sp: URLSearchParams, key: string): string | undefined {
  const v = sp.get(key);
  return v === null || v === "" ? undefined : v;
}

export function parseJobsQuery(sp: URLSearchParams): ParseJobsQueryResult {
  const raw: Record<string, unknown> = {};
  for (const key of ["q", "stacksMode", "origin", "workMode", "lang", "since", "cursor"]) {
    raw[key] = readScalar(sp, key);
  }
  for (const key of LIST_KEYS) raw[key] = readList(sp, key);

  // `q` só com espaços vira undefined em vez de erro.
  if (typeof raw.q === "string" && raw.q.trim() === "") raw.q = undefined;

  const ab = readScalar(sp, "acceptsBrazil");
  if (ab !== undefined) raw.acceptsBrazil = ab === "true" ? true : ab === "false" ? false : ab;

  const limit = readScalar(sp, "limit");
  if (limit !== undefined) raw.limit = /^-?\d+$/.test(limit) ? Number(limit) : limit;

  const parsed = jobsQuerySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "query";
    return {
      ok: false,
      error: { code: "invalid_query", message: `Parâmetro inválido: ${path}` },
    };
  }
  // Remove chaves undefined para que o valor seja estruturalmente limpo.
  const value = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  ) as JobsQuery;
  return { ok: true, value };
}
