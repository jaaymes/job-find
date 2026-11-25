import "client-only";

import { createStore, useStore, type SetResult, type Store } from "@/lib/client/storage/store";
import { z } from "@/lib/shared/zod";
import type { JobSummary } from "@/lib/shared/types/job";

export const JOB_STATUSES = ["none", "saved", "applied", "interview", "offer", "rejected"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const STATUS_LABELS: Record<JobStatus, string> = {
  none: "Sem status",
  saved: "Salva",
  applied: "Aplicada",
  interview: "Entrevista",
  offer: "Proposta",
  rejected: "Recusada",
};

/**
 * Cópia mínima da vaga, gravada na primeira interação: é o que mantém a vaga em "Minhas vagas" depois que ela sai
 * do índice público. `urlCanonical` vem da listagem e do detalhe; só é `null` em snapshots gravados antes de a listagem trazer o campo.
 */
const Snapshot = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  company: z.string(),
  urlCanonical: z.string().nullable(),
  stacks: z.array(z.string()),
  workMode: z.enum(["remote", "hybrid", "onsite", "unknown"]),
  publishedAt: z.string(),
});
export type JobSnapshot = z.infer<typeof Snapshot>;

const Status = z.enum(JOB_STATUSES);

export const JobState = z.object({
  favorite: z.boolean(),
  hidden: z.boolean(),
  status: Status,
  statusHistory: z.array(z.object({ status: Status, at: z.string() })),
  snapshot: Snapshot,
});
export type JobState = z.infer<typeof JobState>;

/** O que basta para gravar o snapshot: serve a `JobSummary`, a `JobDetail` e ao próprio snapshot. */
export type SnapshotSource = Pick<JobSummary, "id" | "title" | "company" | "stacks" | "workMode" | "publishedAt"> & {
  urlCanonical?: string | null;
};

/** Valida cada entrada à parte: uma entrada corrompida some sozinha, sem levar as outras junto. */
const JobStates = z.record(z.string(), z.unknown()).transform((all) => {
  const ok: Record<string, JobState> = {};
  for (const [key, raw] of Object.entries(all)) {
    const parsed = JobState.safeParse(raw);
    if (parsed.success && key === String(parsed.data.snapshot.id)) ok[key] = parsed.data;
  }
  return ok;
});

/** Um único store com o estado de todas as vagas: `id` -> estado. */
export const jobStateStore: Store<Record<string, JobState>> = createStore("jobfind:v1:jobState", JobStates, {
  version: 1,
  initial: {},
});

/** Estado de todas as vagas; `null` no servidor e na hidratação (nada que dependa disso aparece no pré-render). */
export function useJobStates(): Record<string, JobState> | null {
  return useStore(jobStateStore);
}

export function snapshotOf(job: SnapshotSource, previous?: JobSnapshot): JobSnapshot {
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    urlCanonical: job.urlCanonical ?? previous?.urlCanonical ?? null,
    stacks: job.stacks,
    workMode: job.workMode,
    publishedAt: job.publishedAt,
  };
}

const blank = (job: SnapshotSource): JobState => ({
  favorite: false,
  hidden: false,
  status: "none",
  statusHistory: [],
  snapshot: snapshotOf(job),
});

/** Grava o novo estado; sem nenhum sinal (favorita, oculta, status ou histórico) a entrada é removida. */
function write(job: SnapshotSource, change: (s: JobState) => JobState): SetResult {
  const all = jobStateStore.get();
  const key = String(job.id);
  const next = change(all[key] ?? blank(job));
  const rest = { ...all };
  delete rest[key];
  const empty = !next.favorite && !next.hidden && next.status === "none" && next.statusHistory.length === 0;
  return jobStateStore.set(empty ? rest : { ...rest, [key]: next });
}

export const setFavorite = (job: SnapshotSource, favorite: boolean): SetResult =>
  write(job, (s) => ({ ...s, favorite }));

export const setHidden = (job: SnapshotSource, hidden: boolean): SetResult =>
  write(job, (s) => ({ ...s, hidden }));

/** Qualquer transição é válida (inclusive voltar para `none`); repetir o status atual não faz nada. */
export function setStatus(job: SnapshotSource, status: JobStatus): SetResult {
  if ((jobStateStore.get()[String(job.id)]?.status ?? "none") === status) return { ok: true };
  return write(job, (s) => ({
    ...s,
    status,
    statusHistory: [...s.statusHistory, { status, at: new Date().toISOString() }],
  }));
}

/** Etapa "Salvas" do funil de Minhas vagas: status Salva, ou favorita ainda sem status. */
export const isSavedStage = (s: JobState): boolean => s.status === "saved" || (s.status === "none" && s.favorite);

/** ISO da última mudança para "Aplicada"; `null` se o status atual não é esse. */
export function appliedAt(s: JobState | undefined): string | null {
  if (!s || s.status !== "applied") return null;
  for (let i = s.statusHistory.length - 1; i >= 0; i--) {
    if (s.statusHistory[i].status === "applied") return s.statusHistory[i].at;
  }
  return null;
}

/**
 * Atualiza o snapshot das vagas que já têm estado quando a vaga é vista de novo com dados diferentes
 * (título, empresa etc.). Uma única gravação; devolve se algo mudou.
 */
export function syncSnapshots(jobs: SnapshotSource[]): boolean {
  const all = jobStateStore.get();
  let next: Record<string, JobState> | null = null;
  for (const job of jobs) {
    const current: JobState | undefined = (next ?? all)[String(job.id)];
    if (!current) continue;
    const snapshot = snapshotOf(job, current.snapshot);
    if (JSON.stringify(snapshot) === JSON.stringify(current.snapshot)) continue;
    next = { ...(next ?? all), [String(job.id)]: { ...current, snapshot } };
  }
  if (!next) return false;
  return jobStateStore.set(next).ok;
}
