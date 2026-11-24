import type { JobSummary, Seniority, SourceId, WorkMode } from "@/lib/shared/types/job";

export const SOURCE_LABELS: Record<SourceId, string> = {
  himalayas: "Himalayas",
  greenhouse: "Greenhouse",
  ashby: "Ashby",
  lever: "Lever",
  jobicy: "Jobicy",
  github: "GitHub",
  wwr: "We Work Remotely",
  remoteok: "RemoteOK",
  hn: "Hacker News",
  smartrecruiters: "SmartRecruiters",
};

export const SENIORITY_LABELS: Record<Seniority, string> = {
  intern: "Estágio",
  junior: "Júnior",
  mid: "Pleno",
  senior: "Sênior",
  lead: "Lead / Staff",
};

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: "Remoto",
  hybrid: "Híbrido",
  onsite: "Presencial",
  unknown: "Modelo não informado",
};

export const LANGUAGE_LABELS: Record<string, string> = { pt: "Português", en: "Inglês", es: "Espanhol" };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Coleta considerada atrasada: a última coleta com sucesso tem mais de 3 h. */
export const STALE_AFTER_MS = 3 * HOUR;

/** "há 23 min", "há 2 h", "há 1 dia", "há 3 dias". */
export function formatAge(iso: string, now: number): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  if (diff < HOUR) return `há ${Math.max(1, Math.floor(diff / MINUTE))} min`;
  if (diff < DAY) return `há ${Math.floor(diff / HOUR)} h`;
  const days = Math.floor(diff / DAY);
  return days === 1 ? "há 1 dia" : `há ${days} dias`;
}

export function isStale(lastCollectedAt: string | null, now: number): boolean {
  return lastCollectedAt !== null && now - new Date(lastCollectedAt).getTime() > STALE_AFTER_MS;
}

/**
 * Fonte com coleta parada: a última coleta com sucesso tem mais de 3 h, ou nunca houve sucesso e a fonte já
 * está `failing` (3 falhas seguidas). Uma primeira falha recente não conta.
 */
export function isSourceStale(lastSuccessAt: string | null, failing: boolean, now: number): boolean {
  return lastSuccessAt === null ? failing : isStale(lastSuccessAt, now);
}

/** Horário e data de uma coleta no fuso de São Paulo, ex.: `{ time: "10:15", date: "23/11/2026" }`. */
export function formatCollectedAt(iso: string): { time: string; date: string } {
  const d = new Date(iso);
  const timeZone = "America/Sao_Paulo";
  return {
    time: d.toLocaleTimeString("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" }),
    date: d.toLocaleDateString("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }),
  };
}

export function placeLabel(job: Pick<JobSummary, "city" | "country" | "acceptsBrazil" | "origin">): string {
  const place =
    job.city && job.country ? `${job.city}, ${job.country}` : (job.city ?? job.country ?? null);
  const accepts = job.acceptsBrazil === true && job.origin !== "national";
  if (place && accepts) return `${place} · aceita Brasil`;
  if (place) return place;
  return accepts ? "Aceita Brasil" : "Local não informado";
}

export function sourceLabel(sources: SourceId[]): string {
  const first = sources[0];
  if (!first) return "fonte desconhecida";
  const name = SOURCE_LABELS[first];
  return sources.length > 1 ? `${name} +${sources.length - 1}` : name;
}

const PERIOD_LABELS: Record<NonNullable<JobSummary["salaryPeriod"]>, string> = {
  hour: "hora",
  month: "mês",
  year: "ano",
};

const CURRENCY_PREFIX: Record<string, string> = { BRL: "R$", USD: "US$", EUR: "€" };

/**
 * "R$ 14.000 – 18.000 / mês", "a partir de US$ 120.000 / ano", "até CHF 5.000"; `null` quando a vaga não
 * informa salário. Moeda fora de BRL/USD/EUR leva o código ISO como prefixo.
 */
export function formatSalary(
  job: Pick<JobSummary, "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod">,
): string | null {
  const { salaryMin: min, salaryMax: max } = job;
  if (min === null && max === null) return null;
  const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const code = job.salaryCurrency?.toUpperCase() ?? null;
  const prefix = code === null ? "" : `${CURRENCY_PREFIX[code] ?? code} `;
  const period = job.salaryPeriod ? ` / ${PERIOD_LABELS[job.salaryPeriod]}` : "";
  const value = (n: number) => `${prefix}${nf.format(n)}`;
  let text: string;
  if (min !== null && max !== null) {
    text = min === max ? value(min) : `${value(min)} – ${nf.format(max)}`;
  } else if (min !== null) {
    text = `a partir de ${value(min)}`;
  } else {
    text = `até ${value(max as number)}`;
  }
  return `${text}${period}`;
}
