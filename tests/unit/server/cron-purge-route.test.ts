import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  purgeOld: vi.fn<(db: unknown, now: Date) => Promise<{ jobs: number; sourceRuns: number; complete: boolean }>>(),
  end: vi.fn(async () => undefined),
  getPoolDb: vi.fn(),
}));

vi.mock("@/lib/server/jobs/expire", () => ({ purgeOld: m.purgeOld }));
vi.mock("@/lib/server/db/client", () => ({ getPoolDb: m.getPoolDb }));

import { GET, POST, maxDuration } from "@/app/api/cron/purge/route";

const req = (auth?: string) =>
  new Request("http://localhost/api/cron/purge", { headers: auth ? { authorization: auth } : {} });

describe("/api/cron/purge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getPoolDb.mockImplementation(() => ({ $client: { end: m.end } }));
    vi.stubEnv("CRON_SECRET", "s3cr3t");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("expõe maxDuration 60 e GET/POST", () => {
    expect(maxDuration).toBe(60);
    expect(POST).toBe(GET);
  });

  it("401 sem header ou com segredo errado, sem tocar no banco", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer errado"))).status).toBe(401);
    expect(m.getPoolDb).not.toHaveBeenCalled();
  });

  it("200 com as contagens e fecha o pool", async () => {
    m.purgeOld.mockResolvedValue({ jobs: 3, sourceRuns: 7, complete: true });
    const res = await GET(req("Bearer s3cr3t"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ jobs: 3, sourceRuns: 7, complete: true });
    expect(console.log).toHaveBeenCalledWith("[cron/purge] jobs=3 sourceRuns=7 complete=true");
    expect(console.warn).not.toHaveBeenCalled();
    expect(m.end).toHaveBeenCalledTimes(1);
  });

  it("avisa no log quando a limpeza parou por tempo", async () => {
    m.purgeOld.mockResolvedValue({ jobs: 1, sourceRuns: 0, complete: false });
    const res = await GET(req("Bearer s3cr3t"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobs: 1, sourceRuns: 0, complete: false });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("500 quando a limpeza falha, registra o erro e fecha o pool", async () => {
    m.purgeOld.mockRejectedValue(new Error("boom"));
    const res = await GET(req("Bearer s3cr3t"));
    expect(res.status).toBe(500);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(console.error).toHaveBeenCalled();
    expect(m.end).toHaveBeenCalledTimes(1);
  });
});
