import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  afterCallbacks: [] as Array<() => Promise<void> | void>,
  invalidateByTag: vi.fn<(tag: string) => Promise<void>>(async () => undefined),
  runCollection: vi.fn<(opts: unknown) => Promise<unknown[]>>(async () => []),
  end: vi.fn(async () => undefined),
}));
const { afterCallbacks, invalidateByTag, runCollection, end } = m;
const fakeDb = { $client: { end } };

vi.mock("next/server", () => ({
  after: (cb: () => Promise<void> | void) => {
    m.afterCallbacks.push(cb);
  },
}));
vi.mock("@vercel/functions", () => ({ invalidateByTag: m.invalidateByTag }));
vi.mock("@/lib/server/collect/run", () => ({ runCollection: m.runCollection }));
vi.mock("@/lib/server/db/client", () => ({ getPoolDb: () => ({ $client: { end: m.end } }) }));

import { CONNECTORS } from "@/lib/server/sources/registry";
import { GET, POST, maxDuration } from "@/app/api/cron/collect/route";

const URL_BASE = "http://localhost/api/cron/collect";
const req = (qs = "", auth?: string, method = "GET") =>
  new Request(URL_BASE + qs, { method, headers: auth ? { authorization: auth } : {} });

describe("/api/cron/collect", () => {
  beforeEach(() => {
    afterCallbacks.length = 0;
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "s3cr3t");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("expõe maxDuration 300 e GET/POST", () => {
    expect(maxDuration).toBe(300);
    expect(POST).toBe(GET);
  });

  it("401 sem header, com segredo errado ou sem CRON_SECRET", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("", "Bearer errado"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(req("", "Bearer "));
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(afterCallbacks).toHaveLength(0);
    expect(runCollection).not.toHaveBeenCalled();
  });

  it("400 para fonte desconhecida", async () => {
    const res = await GET(req("?sources=foo", "Bearer s3cr3t"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_sources");
    expect(afterCallbacks).toHaveLength(0);
  });

  it("202 com todas as fontes por padrão e roda a coleta no after()", async () => {
    const res = await GET(req("", "Bearer s3cr3t"));
    expect(res.status).toBe(202);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect((await res.json()).accepted).toEqual(Object.keys(CONNECTORS));
    expect(runCollection).not.toHaveBeenCalled();
    await afterCallbacks[0]();
    expect(runCollection).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("202 com as fontes pedidas; after chama runCollection e invalida a tag", async () => {
    const [a, b] = Object.keys(CONNECTORS);
    const res = await POST(req(`?sources=${a},${b}`, "Bearer s3cr3t", "POST"));
    expect(res.status).toBe(202);
    expect((await res.json()).accepted).toEqual([a, b]);
    await afterCallbacks[0]();
    const opts = runCollection.mock.calls[0][0] as {
      db: unknown;
      sources: string[];
      now: Date;
      invalidate: (t: string) => Promise<void>;
    };
    expect(opts.db).toEqual(fakeDb);
    expect(opts.sources).toEqual([a, b]);
    expect(opts.now).toBeInstanceOf(Date);
    await opts.invalidate("jobs");
    expect(invalidateByTag).toHaveBeenCalledWith("jobs");
  });

  it("falha dentro do after é capturada e o pool é fechado", async () => {
    runCollection.mockRejectedValueOnce(new Error("boom"));
    await GET(req("", "Bearer s3cr3t"));
    await expect(afterCallbacks[0]()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
    expect(end).toHaveBeenCalledTimes(1);
  });
});
