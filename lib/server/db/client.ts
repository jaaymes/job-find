import "server-only";
import { Pool, neon } from "@neondatabase/serverless";
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
  return url;
}

/** Leituras: driver HTTP (sem transações), com `db.batch()`. */
export function getHttpDb(url: string | undefined = process.env.DATABASE_URL) {
  return drizzleHttp(neon(requireUrl(url)), { schema });
}

/** Coletor e transações: Pool sobre WebSocket. */
export function getPoolDb(url: string | undefined = process.env.DATABASE_URL) {
  return drizzleServerless(new Pool({ connectionString: requireUrl(url) }), { schema });
}
