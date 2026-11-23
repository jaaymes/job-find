import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { resetDb, testDb } from "../setup";

// A rota usa `getHttpDb()` (neon-http); nos testes ele devolve o node-postgres.
const dbHolder = vi.hoisted(() => ({ get: undefined as undefined | (() => unknown) }));
vi.mock("@/lib/server/db/client", () => ({
  getHttpDb: () => dbHolder.get?.(),
}));

import { GET } from "@/app/api/sources/status/route";
import { CONNECTORS } from "@/lib/server/sources/registry";
import type { SourcesStatusResponse } from "@/lib/shared/types/sources-status";

beforeEach(async () => {
  await resetDb();
  const db = await testDb();
  dbHolder.get = () => db;
});

async function fetchStatus() {
  const res = await GET();
  expect(res.status).toBe(200);
  const body = (await res.json()) as SourcesStatusResponse;
  return { res, body, by: (s: string) => body.sources.find((x) => x.source === s)! };
}

describe("GET /api/sources/status", () => {
  it("lista todos os conectores registrados; sem estado, a fonte é ok com valores nulos", async () => {
    const { body, by } = await fetchStatus();
    expect(body.sources.map((s) => s.source).sort()).toEqual(Object.keys(CONNECTORS).sort());
    expect(by("lever")).toEqual({
      source: "lever",
      label: "Lever",
      attributionUrl: "https://www.lever.co",
      dofollow: false,
      status: "ok",
      lastSuccessAt: null,
      lastRun: null,
    });
    expect(by("remoteok").dofollow).toBe(true);
  });

  it("2 falhas seguidas continuam ok; 3 viram failing", async () => {
    const db = await testDb();
    await db.execute(
      sql`INSERT INTO source_state (source, consecutive_failures, last_success_at) VALUES
        ('lever', 2, '2026-01-01T00:00:00Z'), ('ashby', 3, '2026-01-01T00:00:00Z'), ('hn', 7, NULL)`,
    );
    const { by } = await fetchStatus();
    expect(by("lever").status).toBe("ok");
    expect(by("lever").lastSuccessAt).toBe("2026-01-01T00:00:00.000Z");
    expect(by("ashby").status).toBe("failing");
    expect(by("hn").status).toBe("failing");
    expect(by("hn").lastSuccessAt).toBeNull();
  });

  it("lastRun é a execução mais recente da fonte, sem texto de erro", async () => {
    const db = await testDb();
    await db.execute(
      sql`INSERT INTO source_runs (source, started_at, finished_at, status, fetched_count, new_count, error) VALUES
        ('lever', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 'ok', 10, 4, NULL),
        ('lever', '2026-01-02T00:00:00Z', '2026-01-02T00:01:00Z', 'error', NULL, NULL, 'upstream 500 em https://interno.exemplo/segredo?token=abc'),
        ('ashby', '2026-01-03T00:00:00Z', '2026-01-03T00:01:00Z', 'ok', 20, 5, NULL)`,
    );
    const { res, by } = await fetchStatus();
    expect(by("lever").lastRun).toEqual({
      startedAt: "2026-01-02T00:00:00.000Z",
      status: "error",
      fetched: null,
      inserted: null,
    });
    expect(by("ashby").lastRun).toEqual({
      startedAt: "2026-01-03T00:00:00.000Z",
      status: "ok",
      fetched: 20,
      inserted: 5,
    });
    expect(by("hn").lastRun).toBeNull();
    expect(JSON.stringify(by("lever"))).not.toMatch(/upstream|segredo|token=abc|"error":/);
    expect(res.status).toBe(200);
  });

  it("cache de 5 min na CDN", async () => {
    const { res } = await fetchStatus();
    expect(res.headers.get("Vercel-CDN-Cache-Control")).toMatch(/^s-maxage=300, stale-while-revalidate=\d+/);
    expect(res.headers.get("Vercel-Cache-Tag")).toBe("sources-status");
  });
});
