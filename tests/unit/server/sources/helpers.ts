import type { ConnectorContext, SafeFetch, SafeResponse } from "@/lib/server/sources/types";

export type FakeCtxOptions = {
  /** Resolve a URL pedida para o corpo JSON (ou texto) servido; `undefined` vira 404. */
  serve: (url: URL) => unknown;
  cursor?: string | null;
  /** Prazo da fonte em epoch ms; o padrão é 60 s à frente. */
  deadlineAt?: number;
};

export type FakeCtx = ConnectorContext & {
  requests: { url: string; headers: Record<string, string> }[];
  cursors: (string | null)[];
  /** Falhas parciais reportadas pelo conector via `reportPartial`. */
  partials: { label: string; error: unknown }[];
  /** Prefixos de escopo reportados via `reportScope`, um array por chamada. */
  scopes: string[][];
};

function response(url: string, status: number, body: unknown): SafeResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? null);
  return {
    status,
    url,
    headers: new Headers(),
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
  };
}

/** Contexto de conector sem rede: `serve` entrega as fixtures por URL/query. */
export function fakeCtx(opts: FakeCtxOptions): FakeCtx {
  const requests: FakeCtx["requests"] = [];
  const cursors: FakeCtx["cursors"] = [];
  const partials: FakeCtx["partials"] = [];
  const scopes: FakeCtx["scopes"] = [];
  const fetcher: SafeFetch = async (url, init) => {
    requests.push({ url, headers: init?.headers ?? {} });
    const body = opts.serve(new URL(url));
    return body === undefined ? response(url, 404, "") : response(url, 200, body);
  };
  return {
    fetchJson: fetcher,
    fetchText: fetcher,
    cursor: opts.cursor ?? null,
    setCursor: (c) => {
      cursors.push(c);
    },
    reportPartial: (label, error) => {
      partials.push({ label, error });
    },
    reportScope: (prefixes) => {
      scopes.push([...prefixes]);
    },
    deadlineAt: opts.deadlineAt ?? Date.now() + 60_000,
    signal: new AbortController().signal,
    now: new Date("2026-11-23T12:00:00Z"),
    requests,
    cursors,
    partials,
    scopes,
  };
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}
