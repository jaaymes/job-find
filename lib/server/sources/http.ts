import "server-only";
import { fetch } from "undici";
import type { SafeFetch, SafeResponse } from "@/lib/server/sources/types";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const RETRY_BASE_DELAY_MS = 300;
const RETRY_MAX_DELAY_MS = 3_000;
const DEFAULT_HEADERS: Record<string, string> = {
  "user-agent": "job-find-aggregator/1.0 (+job aggregator; respects robots and rate limits)",
  accept: "application/json, text/html;q=0.9, */*;q=0.5",
};

type Options = { timeoutMs?: number; maxBytes?: number; headers?: Record<string, string> };

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds * 1000, RETRY_MAX_DELAY_MS);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function readBodyCapped(body: { getReader(): ReadableStreamDefaultReader<Uint8Array> } | null, maxBytes: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`tamanho da resposta excede o limite de ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fetch restrito para as fontes (SEC-06): só https para hosts da allowlist, redirect manual
 * (máx. 3 saltos, cada um revalidado), timeout total, limite de bytes em streaming e
 * 1 retentativa em 5xx/429.
 */
export function createSafeFetch(allowedHosts: string[], opts: Options = {}): SafeFetch {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));

  const assertAllowed = (raw: string, context: string): URL => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`${context}URL inválida`);
    }
    if (url.protocol !== "https:" || !allowed.has(url.hostname.toLowerCase())) {
      throw new Error(`${context}host não permitido: ${url.protocol}//${url.hostname}`);
    }
    return url;
  };

  return async (url, init = {}) => {
    assertAllowed(url, "");

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`timeout após ${timeoutMs} ms`));
    }, timeoutMs);
    const external = init.signal;
    const onExternalAbort = () => controller.abort(external?.reason);
    if (external) {
      if (external.aborted) onExternalAbort();
      else external.addEventListener("abort", onExternalAbort, { once: true });
    }
    const headers = { ...DEFAULT_HEADERS, ...opts.headers, ...init.headers };

    try {
      let current = url;
      let redirects = 0;
      let retried = false;
      for (;;) {
        const res = await fetch(current, { headers, redirect: "manual", signal: controller.signal });

        if (REDIRECT_STATUSES.has(res.status)) {
          await res.body?.cancel().catch(() => undefined);
          const location = res.headers.get("location");
          if (!location) throw new Error(`redirect sem Location (status ${res.status})`);
          if (++redirects > MAX_REDIRECTS) throw new Error(`redirect: mais de ${MAX_REDIRECTS} saltos`);
          current = assertAllowed(new URL(location, current).toString(), "redirect bloqueado: ").toString();
          continue;
        }

        if ((res.status >= 500 || res.status === 429) && !retried) {
          retried = true;
          await res.body?.cancel().catch(() => undefined);
          const wait = parseRetryAfterMs(res.headers.get("retry-after")) ?? RETRY_BASE_DELAY_MS;
          await sleep(wait, controller.signal);
          continue;
        }

        if (res.status < 200 || res.status >= 300) {
          await res.body?.cancel().catch(() => undefined);
          throw new Error(`resposta HTTP ${res.status} de ${new URL(current).hostname}`);
        }

        const declared = Number(res.headers.get("content-length"));
        if (Number.isFinite(declared) && declared > maxBytes) {
          await res.body?.cancel().catch(() => undefined);
          throw new Error(`tamanho da resposta (${declared} bytes) excede o limite de ${maxBytes} bytes`);
        }

        const bodyText = await readBodyCapped(res.body as Parameters<typeof readBodyCapped>[0], maxBytes);
        const out: SafeResponse = {
          status: res.status,
          url: current,
          headers: res.headers as unknown as Headers,
          text: async () => bodyText,
          json: async () => JSON.parse(bodyText) as unknown,
        };
        return out;
      }
    } catch (err) {
      if (timedOut) throw new Error(`timeout após ${timeoutMs} ms`);
      throw err;
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    }
  };
}
