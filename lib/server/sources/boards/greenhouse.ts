/**
 * Boards de Greenhouse consultados (D-03): nada além desta lista é consultado.
 * Gerada por `pnpm tsx scripts/discover-boards.ts --ats greenhouse` e revista à mão: só entram boards com vagas de tecnologia
 * (filtro RN-01, `isTechJob`) ou com vagas para o Brasil; os com mais vagas para o Brasil vêm primeiro e os curados
 * originais ficam todos. O rodízio da coleta dá conta da lista inteira.
 */
export const GREENHOUSE_BOARDS = [
  "btgpactual", "inter", "c6bank", "quintoandar", "clara", "gympass",
  "vtex", "stone", "getnet", "ebanx", "xpinc", "wildlifestudios",
  "databricks", "stripe", "datadog", "jusbrasil", "twilio", "canonical",
  "gitlab", "proton", "discord", "earnin", "gemini", "gocardless",
  "icarus", "algolia", "censys", "dominodatalab", "kalshi", "movableink",
  "nextdoor", "pendo", "otterai", "invisibletech", "arizeai", "greenhouse",
  "parallel", "coast", "ginkgobioworks", "speechmatics", "assemblyai", "attain",
  "recidiviz", "taskrabbit", "wikimedia", "albedo", "cognism", "givecampus",
  "lithic", "planetscale", "prodigal", "project44", "stitchfix", "swayable",
  "bigid", "bitmovin", "blend", "future", "karat", "limrun",
  "pelago", "goguardian", "highnote", "imply", "inflectionai", "netlify",
  "observeai", "radar", "wasabi", "calendly", "flexe", "novacredit",
  "offerup", "postscript", "seekout", "sendbird", "tempo", "vectara",
  "calm", "cameo", "imbue", "legalist", "recall", "stabilityai",
  "treasuryprime", "weave",
] as const;
