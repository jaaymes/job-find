import { MockAgent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSafeFetch } from "@/lib/server/sources/http";

const HOST = "api.example.com";
const ORIGIN = `https://${HOST}`;

describe("createSafeFetch", () => {
  let agent: MockAgent;
  let previous: Dispatcher;
  let pool: ReturnType<MockAgent["get"]>;

  beforeEach(() => {
    previous = getGlobalDispatcher();
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
    pool = agent.get(ORIGIN);
  });

  afterEach(async () => {
    await agent.close();
    setGlobalDispatcher(previous);
  });

  it("rejeita host fora da allowlist", async () => {
    const f = createSafeFetch([HOST]);
    await expect(f("https://evil.com/x")).rejects.toThrow(/host não permitido/);
  });

  it("rejeita URL http://", async () => {
    const f = createSafeFetch([HOST]);
    await expect(f(`http://${HOST}/x`)).rejects.toThrow(/host não permitido/);
  });

  it("rejeita redirect para host fora da allowlist", async () => {
    pool.intercept({ path: "/r" }).reply(302, "", { headers: { location: "http://169.254.169.254/" } });
    const f = createSafeFetch([HOST]);
    await expect(f(`${ORIGIN}/r`)).rejects.toThrow(/redirect/);
  });

  it("segue redirect dentro da allowlist", async () => {
    pool.intercept({ path: "/a" }).reply(302, "", { headers: { location: "/b" } });
    pool.intercept({ path: "/b" }).reply(200, '{"ok":true}');
    const res = await createSafeFetch([HOST])(`${ORIGIN}/a`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejeita mais de 3 redirects", async () => {
    for (const p of ["/1", "/2", "/3", "/4"]) {
      pool.intercept({ path: p }).reply(302, "", { headers: { location: `/${Number(p.slice(1)) + 1}` } });
    }
    await expect(createSafeFetch([HOST])(`${ORIGIN}/1`)).rejects.toThrow(/redirect/);
  });

  it("rejeita corpo acima do limite (tamanho)", async () => {
    pool.intercept({ path: "/big" }).reply(200, "x".repeat(11 * 1024 * 1024));
    await expect(createSafeFetch([HOST])(`${ORIGIN}/big`)).rejects.toThrow(/tamanho/);
  });

  it("rejeita Content-Length acima do limite sem ler o corpo", async () => {
    pool
      .intercept({ path: "/cl" })
      .reply(200, "ok", { headers: { "content-length": String(50 * 1024 * 1024) } });
    await expect(createSafeFetch([HOST])(`${ORIGIN}/cl`)).rejects.toThrow(/tamanho/);
  });

  it("aborta por timeout", async () => {
    pool.intercept({ path: "/slow" }).reply(200, "ok").delay(25_000);
    const f = createSafeFetch([HOST], { timeoutMs: 100 });
    await expect(f(`${ORIGIN}/slow`)).rejects.toThrow(/timeout/);
  });

  it("tenta de novo uma vez em 5xx e funciona", async () => {
    pool.intercept({ path: "/flaky" }).reply(503, "", { headers: { "retry-after": "0" } });
    pool.intercept({ path: "/flaky" }).reply(200, "fine");
    const res = await createSafeFetch([HOST])(`${ORIGIN}/flaky`);
    expect(await res.text()).toBe("fine");
  });

  it("falha com o status após esgotar a retentativa", async () => {
    pool.intercept({ path: "/down" }).reply(500, "").times(2);
    await expect(createSafeFetch([HOST])(`${ORIGIN}/down`)).rejects.toThrow(/500/);
  });

  it("envia POST com corpo e cabeçalhos", async () => {
    pool
      .intercept({ path: "/runs", method: "POST", body: '{"a":1}', headers: { "content-type": "application/json" } })
      .reply(201, '{"data":{"id":"r1"}}');
    const res = await createSafeFetch([HOST])(`${ORIGIN}/runs`, {
      method: "POST",
      body: '{"a":1}',
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ data: { id: "r1" } });
  });

  it("POST não repete em 5xx nem segue redirect", async () => {
    pool.intercept({ path: "/p5", method: "POST" }).reply(503, "");
    await expect(createSafeFetch([HOST])(`${ORIGIN}/p5`, { method: "POST", body: "{}" })).rejects.toThrow(/503/);
    pool.intercept({ path: "/p3", method: "POST" }).reply(302, "", { headers: { location: "/b" } });
    await expect(createSafeFetch([HOST])(`${ORIGIN}/p3`, { method: "POST", body: "{}" })).rejects.toThrow(/redirect/);
  });

  it("não tenta de novo em 404 e informa o status", async () => {
    pool.intercept({ path: "/nf" }).reply(404, "");
    await expect(createSafeFetch([HOST])(`${ORIGIN}/nf`)).rejects.toThrow(/404/);
  });
});
