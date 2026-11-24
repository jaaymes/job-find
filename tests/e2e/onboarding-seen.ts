/** Estado de armazenamento dos testes e2e: o guia de primeira visita já foi visto (não cobre as telas). */
export const ONBOARDING_SEEN = {
  cookies: [],
  origins: [
    {
      origin: "http://localhost:3100",
      localStorage: [
        { name: "jobfind:v1:onboarding", value: JSON.stringify({ v: 1, data: { seenAt: "2026-01-01T00:00:00.000Z" } }) },
      ],
    },
  ],
};
