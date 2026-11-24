import "server-only";
import { Pool, neon, neonConfig } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleServerless } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/** Tipo comum a neon-http, neon-serverless e node-postgres (testes). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

function requireUrl(url: string | undefined): string {
  if (!url) {
    throw new Error("DATABASE_URL não está definida: configure a URL do banco Postgres.");
  }
  configureLocalNeon(url);
  return url;
}

/** Porta do proxy local que imita o Neon (serviço `neon-proxy` do docker-compose.yml). */
const LOCAL_NEON_PROXY_PORT = 4444;

/**
 * Ambiente local (Docker): hosts `*.localtest.me` apontam para o proxy local do Neon,
 * que fala HTTP e WebSocket sem TLS. Em produção (Neon de verdade) nada muda.
 */
function configureLocalNeon(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return;
  }
  if (!host.endsWith(".localtest.me")) return;
  neonConfig.fetchEndpoint = (h) => `http://${h}:${LOCAL_NEON_PROXY_PORT}/sql`;
  neonConfig.wsProxy = (h) => `${h}:${LOCAL_NEON_PROXY_PORT}/v2`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineConnect = false;
}

/** Leituras: driver HTTP (sem transações), com `db.batch()`. */
export function getHttpDb(url: string | undefined = process.env.DATABASE_URL) {
  return drizzleHttp(neon(requireUrl(url)), { schema });
}

/** Coletor e transações: Pool sobre WebSocket. */
export function getPoolDb(url: string | undefined = process.env.DATABASE_URL) {
  return drizzleServerless(new Pool({ connectionString: requireUrl(url) }), { schema });
}
