import { z } from "@/lib/shared/zod";

// CV e carta adaptados à vaga (RF-17, RN-07 camada 1). É o schema que o modelo preenche.
// O modelo só devolve `expId` e bullets reescritos com `sourceBulletIds`: empresa, cargo, datas, formação e
// contato são montados pelo cliente a partir do perfil. `.nullable()` em vez de `.optional()` (json_schema estrito).
export const TailoredDocs = z.object({
  cv: z.object({
    headline: z.string(),
    summary: z.string(),
    /** Competências do perfil, na ordem de relevância para a vaga. */
    skills: z.array(z.string()),
    experiences: z.array(
      z.object({
        /** `exp_N` de uma experiência do perfil. */
        expId: z.string(),
        bullets: z.array(
          z.object({
            text: z.string(),
            /** Ids `exp_N.bM` dos bullets do perfil que sustentam este texto. */
            sourceBulletIds: z.array(z.string()),
          }),
        ),
      }),
    ),
  }),
  /** Carta de apresentação; null quando não solicitada. */
  coverLetter: z.string().nullable(),
});
export type TailoredDocs = z.infer<typeof TailoredDocs>;
