import "client-only";
import { useQuery } from "@tanstack/react-query";
import type { JobDetail } from "@/lib/shared/types/job";

/** A vaga não existe (id inválido, expirada ou removida). */
export class JobNotFoundError extends Error {
  constructor() {
    super("Vaga não encontrada");
    this.name = "JobNotFoundError";
  }
}

/** Só inteiros positivos seguros: qualquer outra coisa nem chega à API. */
export function parseJobId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function fetchJob(id: number, signal: AbortSignal): Promise<JobDetail> {
  const res = await fetch(`/api/jobs/${id}`, { signal });
  if (res.status === 404) throw new JobNotFoundError();
  if (!res.ok) throw new Error(`Falha ao carregar a vaga (HTTP ${res.status})`);
  return (await res.json()) as JobDetail;
}

/** Detalhe da vaga via `/api/jobs/{id}`; com `id` inválido (`null`) não faz requisição. */
export function useJob(id: number | null) {
  return useQuery({
    queryKey: ["job", id],
    queryFn: ({ signal }) => fetchJob(id as number, signal),
    enabled: id !== null,
    retry: (failures, error) => !(error instanceof JobNotFoundError) && failures < 1,
  });
}
