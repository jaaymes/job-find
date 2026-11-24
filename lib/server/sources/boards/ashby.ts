/**
 * Boards de Ashby consultados (D-03): nada além desta lista é consultado.
 * Gerada por `pnpm tsx scripts/discover-boards.ts --ats ashby` e revista à mão: só entram boards com vagas de tecnologia
 * (filtro RN-01, `isTechJob`) ou com vagas para o Brasil; os com mais vagas para o Brasil vêm primeiro e os curados
 * originais ficam todos. O rodízio da coleta dá conta da lista inteira.
 */
export const ASHBY_BOARDS = [
  "nubank", "supabase", "ramp", "plaid", "cohere", "notion",
  "replit", "encord", "vanta", "litellm", "rivet", "braintrust",
  "gamma", "resend", "aiprise", "candidhealth", "gecko-robotics", "linear",
  "solveintelligence", "webflow", "character", "eloquentai", "radar", "rilla",
  "runpod", "attio", "blacksmith", "circuithub", "drata", "quindar",
  "retell-ai", "shepherd", "speak", "synthesia", "luminai", "metriport",
  "tavus", "turion-space", "chariot", "circleback", "lapel", "merge",
  "middesk", "mutiny", "odys-aviation", "pinecone", "pointone", "pulse",
  "sanity", "signoz", "tennr", "ziina", "blissway", "camber",
  "krea", "mach9", "mercura", "padlet", "relling", "rescale",
  "secureframe", "spruceid", "warp", "ycombinator", "9-mothers", "agentmail",
  "aleph", "andromedasurgical", "auctor", "authzed", "beyondreachlabs", "bree",
  "cardboard", "firecrawl", "meticulous", "novig", "numeral", "raindrop",
  "reach", "posthog",
] as const;
