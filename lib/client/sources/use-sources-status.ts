import "client-only";
import { useQuery } from "@tanstack/react-query";
import type { SourcesStatusResponse } from "@/lib/shared/types/sources-status";

async function fetchSourcesStatus(signal: AbortSignal): Promise<SourcesStatusResponse> {
  const res = await fetch("/api/sources/status", { signal });
  if (!res.ok) throw new Error(`Falha ao carregar as fontes (HTTP ${res.status})`);
  return (await res.json()) as SourcesStatusResponse;
}

/** Status das fontes via `/api/sources/status`. */
export function useSourcesStatus() {
  return useQuery({ queryKey: ["sources-status"], queryFn: ({ signal }) => fetchSourcesStatus(signal) });
}
