/// <reference lib="webworker" />
import "client-only";
// Worker dedicado: um por extração. A thread principal o encerra (terminate) no timeout.
import { ExtractError, type ExtractKind } from "./errors";
import { extractCore } from "./extract-core";

self.onmessage = async (ev: MessageEvent<{ kind: ExtractKind; bytes: Uint8Array }>) => {
  try {
    const result = await extractCore(ev.data.bytes, ev.data.kind);
    self.postMessage({ ok: true, result });
  } catch (e) {
    const code = e instanceof ExtractError ? e.code : "failed";
    self.postMessage({ ok: false, code });
  }
};
