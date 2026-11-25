import { z } from "@/lib/shared/zod";

// Perfil do usuário (US-04). Vive só no localStorage; é também o schema que a IA preenche.
// `.nullable()` em vez de `.optional()`: provedores com `json_schema` estrito exigem todos os campos.
export const PROFILE_SCHEMA_VERSION = 2;

export const SENIORITIES = ["junior", "mid", "senior", "lead"] as const;
export const ENGLISH_LEVELS = ["none", "basic", "intermediate", "advanced", "fluent"] as const;

export const LANGUAGE_LEVELS = ["basic", "intermediate", "advanced", "fluent", "native"] as const;
export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];

/** Máximo de bullets destacados (template `resultados`). */
export const MAX_HIGHLIGHTS = 3;

export const Profile = z.object({
  schemaVersion: z.literal(PROFILE_SCHEMA_VERSION),
  name: z.string().nullable(),
  headline: z.string().nullable(),
  location: z.string().nullable(),
  seniority: z.enum(SENIORITIES).nullable(),
  englishLevel: z.enum(ENGLISH_LEVELS).nullable(),
  summary: z.string().nullable(),
  contact: z.object({
    email: z.string().nullable(),
    phone: z.string().nullable(),
    links: z.array(z.string()),
  }),
  skills: z.array(
    z.object({
      name: z.string(),
      years: z.number().nullable(),
      /** Id canônico da stack (`normalizeSkill`), ou null quando a competência não é uma stack conhecida. */
      stackId: z.string().nullable(),
    }),
  ),
  experiences: z.array(
    z.object({
      /** `exp_N`, único no perfil. */
      id: z.string(),
      company: z.string(),
      title: z.string(),
      /** `AAAA-MM` ou `AAAA`. */
      startDate: z.string().nullable(),
      /** null = emprego atual. */
      endDate: z.string().nullable(),
      /** Bullets com `id` `exp_N.bM`. */
      bullets: z.array(z.object({ id: z.string(), text: z.string() })),
    }),
  ),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string().nullable(),
      startYear: z.string().nullable(),
      endYear: z.string().nullable(),
    }),
  ),
  projects: z.array(
    z.object({
      /** `proj_N`, único no perfil. */
      id: z.string(),
      name: z.string(),
      link: z.string().nullable(),
      stacks: z.array(z.string()),
      /** Bullets com `id` `proj_N.bM`. */
      bullets: z.array(z.object({ id: z.string(), text: z.string() })),
    }),
  ),
  certifications: z.array(
    z.object({
      name: z.string(),
      issuer: z.string().nullable(),
      year: z.string().nullable(),
    }),
  ),
  languages: z.array(z.object({ name: z.string(), level: z.enum(LANGUAGE_LEVELS) })),
  /** Ids `exp_N.bM` de até `MAX_HIGHLIGHTS` bullets destacados. */
  highlights: z.array(z.string()),
});
export type Profile = z.infer<typeof Profile>;

export const SENIORITY_LABEL: Record<(typeof SENIORITIES)[number], string> = {
  junior: "Júnior",
  mid: "Pleno",
  senior: "Sênior",
  lead: "Liderança",
};

export const ENGLISH_LABEL: Record<(typeof ENGLISH_LEVELS)[number], string> = {
  none: "Nenhum",
  basic: "Básico",
  intermediate: "Intermediário",
  advanced: "Avançado",
  fluent: "Fluente",
};

export const LANGUAGE_LEVEL_LABEL: Record<"pt" | "en" | "es", Record<LanguageLevel, string>> = {
  pt: { basic: "Básico", intermediate: "Intermediário", advanced: "Avançado", fluent: "Fluente", native: "Nativo" },
  en: { basic: "Basic", intermediate: "Intermediate", advanced: "Advanced", fluent: "Fluent", native: "Native" },
  es: { basic: "Básico", intermediate: "Intermedio", advanced: "Avanzado", fluent: "Fluido", native: "Nativo" },
};

/** v1 -> v2: acrescenta as listas novas vazias. Valor que não é objeto passa como veio (o `safeParse` rejeita). */
export function migrateProfileV1toV2(old: unknown): unknown {
  if (old === null || typeof old !== "object" || Array.isArray(old)) return old;
  return { ...old, schemaVersion: 2, projects: [], certifications: [], languages: [], highlights: [] };
}

export function emptyProfile(): Profile {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    name: null,
    headline: null,
    location: null,
    seniority: null,
    englishLevel: null,
    summary: null,
    contact: { email: null, phone: null, links: [] },
    skills: [],
    experiences: [],
    education: [],
    projects: [],
    certifications: [],
    languages: [],
    highlights: [],
  };
}
