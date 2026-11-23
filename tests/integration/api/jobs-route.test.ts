import { beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { insertJobRaw, resetDb, testDb } from "../setup";

// A rota usa `getHttpDb()` (neon-http); nos testes ele devolve o node-postgres.
const dbHolder = vi.hoisted(() => ({ get: undefined as undefined | (() => unknown) }));
vi.mock("@/lib/server/db/client", () => ({
  getHttpDb: () => dbHolder.get?.(),
}));

import { GET } from "@/app/api/jobs/route";
import { GET as GET_DETAIL } from "@/app/api/jobs/[id]/route";

const detail = (id: string) =>
  GET_DETAIL(new Request(`http://x/api/jobs/${id}`), { params: Promise.resolve({ id }) });

beforeEach(async () => {
  await resetDb();
  const db = await testDb();
  dbHolder.get = () => db;
});

describe("GET /api/jobs", () => {
  it("400 para query inválida, sem cache longo", async () => {
    const res = await GET(new Request("http://x/api/jobs?limit=500"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid_query", message: expect.any(String) } });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Vercel-CDN-Cache-Control")).toBeNull();
  });

  it("200 com headers de cache, counts e lastCollectedAt", async () => {
    const db = await testDb();
    await insertJobRaw(db, { title: "Vaga A" });
    await db.execute(
      sql`INSERT INTO source_runs (source, started_at, finished_at, status) VALUES ('lever', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 'ok'), ('lever', '2026-01-02T00:00:00Z', '2026-01-02T00:01:00Z', 'error')`,
    );
    const ok = await GET(new Request("http://x/api/jobs"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Vercel-Cache-Tag")).toBe("jobs");
    expect(ok.headers.get("Vercel-CDN-Cache-Control")).toBe(
      "max-age=900, stale-while-revalidate=86400, stale-if-error=86400",
    );
    expect(ok.headers.get("Cache-Control")).toBe("public, max-age=30");
    const body = await ok.json();
    expect(body.counts).toBeDefined();
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
    expect(body.lastCollectedAt).toBe("2026-01-01T00:01:00.000Z");
  });

  it("lastCollectedAt é null sem execuções bem-sucedidas", async () => {
    const body = await (await GET(new Request("http://x/api/jobs"))).json();
    expect(body.lastCollectedAt).toBeNull();
  });

  it("sem counts quando há cursor", async () => {
    const db = await testDb();
    for (let i = 0; i < 3; i++) {
      await insertJobRaw(db, { published_at: new Date(Date.now() - i * 1000) });
    }
    const first = await (await GET(new Request("http://x/api/jobs?limit=2"))).json();
    expect(first.nextCursor).toEqual(expect.any(String));
    const res = await GET(new Request(`http://x/api/jobs?limit=2&cursor=${first.nextCursor}`));
    const second = await res.json();
    expect(second.counts).toBeUndefined();
    expect(second.items).toHaveLength(1);
  });

  it("500 sem stack quando o banco falha", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbHolder.get = () => {
      throw new Error("boom secreto");
    };
    const res = await GET(new Request("http://x/api/jobs"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "internal" } });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("GET /api/jobs/[id]", () => {
  it("404 para vaga inexistente", async () => {
    const res = await detail("999999");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "not_found", message: expect.any(String) } });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each(["abc", "0", "-1", "1.5", "99999999999999999999"])("404 para id inválido %s", async (id) => {
    const res = await detail(id);
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("200 com detalhe e tags jobs,job-<id>", async () => {
    const db = await testDb();
    const { id } = await insertJobRaw(db, { title: "Vaga B" });
    const res = await detail(String(Number(id)));
    expect(res.status).toBe(200);
    expect(res.headers.get("Vercel-Cache-Tag")).toBe(`jobs,job-${Number(id)}`);
    expect(res.headers.get("Vercel-CDN-Cache-Control")).toContain("stale-if-error=86400");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=30");
    const body = await res.json();
    expect(body.title).toBe("Vaga B");
    expect(body.descriptionHtml).toBeDefined();
    expect(body.attribution).toEqual([]);
  });

  it("404 para vaga expirada", async () => {
    const db = await testDb();
    const { id } = await insertJobRaw(db, { expired_at: new Date() });
    expect((await detail(String(Number(id)))).status).toBe(404);
  });

  it("500 sem stack quando o banco falha", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbHolder.get = () => {
      throw new Error("boom");
    };
    const res = await detail("1");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: "internal" } });
    spy.mockRestore();
  });
});
