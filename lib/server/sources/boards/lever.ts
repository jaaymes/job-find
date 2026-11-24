/**
 * Boards de Lever consultados (D-03): nada além desta lista é consultado.
 * Gerada por `pnpm tsx scripts/discover-boards.ts --ats lever` e revista à mão: só entram boards com vagas de tecnologia
 * (filtro RN-01, `isTechJob`) ou com vagas para o Brasil; os com mais vagas para o Brasil vêm primeiro e os curados
 * originais ficam todos. O rodízio da coleta dá conta da lista inteira.
 */
export const LEVER_BOARDS = [
  "ciandt", "swile", "neon", "spotify", "blue", "finch",
  "multiplylabs", "outreach", "fampay", "mashgin", "unusual", "reachpower",
  "smartcuts", "thunkable", "toptal",
] as const;
