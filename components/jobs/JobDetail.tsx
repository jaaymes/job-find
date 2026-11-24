/* eslint-disable @next/next/no-img-element -- logos vêm direto da origem (img-src https:), sem proxy nem otimização. */
"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { syncSnapshots } from "@/lib/client/jobs/job-state";
import { JobNotFoundError, parseJobId, useJob } from "@/lib/client/jobs/use-job";
import { profileStore } from "@/lib/client/profile/store";
import { toSafeHtml } from "@/lib/client/render-html";
import { indexProfile, scoreJob, type Criterion } from "@/lib/client/score/score";
import { useStore } from "@/lib/client/storage/store";
import { safeExternalUrl } from "@/lib/shared/safe-url";
import { STACKS } from "@/lib/shared/stacks";
import type { JobAttribution, JobDetail as JobDetailData } from "@/lib/shared/types/job";
import { AiAnalysis } from "./AiAnalysis";
import { ChanceBadge } from "./ChanceBadge";
import { FavoriteButton, HideButton, StatusBadge, StatusSelect, useJobState } from "./JobActions";
import {
  LANGUAGE_LABELS,
  SENIORITY_LABELS,
  WORK_MODE_LABELS,
  formatAge,
  formatSalary,
  placeLabel,
} from "./format";
import { HardLink } from "@/components/ui/hard-link";

const STACK_LABEL = new Map(STACKS.map((s) => [s.id, s.label]));
const PILL = "rounded-full bg-jf-chip px-2.5 py-1 text-[13px] text-jf-ink-2";
const CARD = "rounded-2xl border border-jf-line bg-jf-surface";
const LINK = "text-jf-brand hover:text-jf-brand-dark underline-offset-2 hover:underline";

function BackLink() {
  return (
    <Link href="/" className={`${LINK} inline-flex min-h-11 items-center gap-1.5 self-start text-sm no-underline`}>
      <span aria-hidden="true">←</span> Voltar para as vagas
    </Link>
  );
}

/** Aviso só para leitor de tela: o link abre outra aba. */
function NewTabHint() {
  return <span className="sr-only"> (abre em nova aba)</span>;
}

function ExternalLink({ attribution, children }: { attribution: JobAttribution; children: React.ReactNode }) {
  const href = safeExternalUrl(attribution.url);
  if (!href) return <>{children}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel={attribution.dofollow ? "noopener noreferrer" : "noopener noreferrer nofollow"}
      className={LINK}
    >
      {children}
      <NewTabHint />
    </a>
  );
}

/** "coletada de Greenhouse e Himalayas", cada fonte com link para o anúncio original. */
function Attribution({ items }: { items: JobAttribution[] }) {
  return (
    <>
      {items.map((a, i) => (
        <Fragment key={`${a.source}-${a.url}`}>
          {i > 0 && (i === items.length - 1 ? " e " : ", ")}
          <ExternalLink attribution={a}>{a.label}</ExternalLink>
        </Fragment>
      ))}
    </>
  );
}

function Logo({ job }: { job: JobDetailData }) {
  const [failed, setFailed] = useState(false);
  const initial = job.company.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      aria-hidden="true"
      className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-jf-chip font-display text-xl font-bold text-jf-ink-2 sm:size-16 sm:text-2xl"
    >
      {job.companyLogoUrl && !failed ? (
        <img
          src={job.companyLogoUrl}
          alt=""
          referrerPolicy="no-referrer"
          width={64}
          height={64}
          className="size-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        initial
      )}
    </div>
  );
}

function Skeleton() {
  return (
    <div role="status" aria-label="Carregando a vaga" className="flex flex-col gap-5">
      <div className="h-11" />
      <div className={`${CARD} h-56 animate-pulse`} />
      <div className={`${CARD} h-80 animate-pulse`} />
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex flex-col items-start gap-4">
      <BackLink />
      <section className={`${CARD} flex w-full flex-col items-start gap-3 p-6 sm:p-8`}>
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Vaga não encontrada</h1>
        <p className="text-[15px] text-jf-ink-2">
          Ela pode ter sido encerrada ou o endereço está incorreto. Veja as vagas mais recentes na lista.
        </p>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-xl bg-jf-brand px-5 font-semibold text-white no-underline hover:bg-jf-brand-dark"
        >
          Ver todas as vagas
        </Link>
      </section>
    </div>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <BackLink />
      <section role="alert" className={`${CARD} flex w-full flex-col items-start gap-3 p-6 sm:p-8`}>
        <h1 className="font-display text-2xl font-bold">Não foi possível carregar a vaga</h1>
        <p className="text-[15px] text-jf-ink-2">Houve um problema de conexão ou do servidor. Tente de novo.</p>
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 rounded-xl border border-jf-line-strong bg-jf-surface px-5 font-semibold text-jf-ink hover:bg-jf-chip"
        >
          Tentar de novo
        </button>
      </section>
    </div>
  );
}

function Description({ job }: { job: JobDetailData }) {
  // Descrição já sanitizada no servidor; renderiza só depois da segunda camada (SEC-02).
  const dofollow = job.attribution.some((a) => a.dofollow);
  const html = useMemo(() => toSafeHtml(job.descriptionHtml, { dofollow }), [job.descriptionHtml, dofollow]);
  return (
    <article className={`${CARD} min-w-0 flex-[999_1_560px] p-5 leading-relaxed sm:p-7`}>
      <h2 className="mb-3 text-xl font-semibold">Sobre a vaga</h2>
      <div
        className="text-jf-ink [&_a]:text-jf-brand [&_a]:underline [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h4]:mt-4 [&_h4]:mb-2 [&_h4]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3.5 [&_ul]:list-disc [&_ul]:pl-5 break-words"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <p className="mt-6 border-t border-jf-line pt-4 text-[13px] text-jf-ink-3">
        Texto original da empresa. Fonte: <Attribution items={job.attribution} />.
      </p>
    </article>
  );
}

const CRITERION_LABEL: Record<Criterion, string> = {
  stack: "Tecnologias",
  seniority: "Senioridade",
  language: "Idioma",
  location: "Local",
  recency: "Recência",
};

/** O score depende do localStorage: só aparece depois da hidratação (antes, `useStore` devolve null). */
function Sidebar({ job, now }: { job: JobDetailData; now: number }) {
  const profile = useStore(profileStore);
  const chance = useMemo(
    () => (profile ? scoreJob(indexProfile(profile), job, new Date(now)) : null),
    [profile, job, now],
  );
  return (
    <aside className="flex max-w-none flex-1 basis-[360px] flex-col gap-4 lg:max-w-[440px]">
      <section aria-labelledby="chance-t" className={`${CARD} flex flex-col gap-3.5 p-5 sm:p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="chance-t" className="text-lg font-semibold">
            Sua chance
          </h2>
          <ChanceBadge band={chance?.band ?? null} score={chance?.score} />
        </div>
        {chance && (
          <>
            <p className="text-[13px] text-jf-ink-3">Por que essa nota, critério a critério:</p>
            <ul aria-label="Detalhes da nota" className="flex flex-col gap-3">
              {chance.breakdown.map((b) => {
                const total = chance.breakdown.reduce((n, x) => n + (x.available ? x.weight : 0), 0);
                return (
                <li key={b.criterion} className="flex flex-col gap-1" data-criterion={b.criterion}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-semibold">{CRITERION_LABEL[b.criterion]}</span>
                    <span className="text-jf-ink-3">
                      {b.available ? `${Math.round(b.value)}% · peso ${Math.round((b.weight / total) * 100)}%` : "sem dados"}
                    </span>
                  </div>
                  <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-jf-chip">
                    <div className="h-full rounded-full bg-jf-brand" style={{ width: `${b.available ? Math.round(b.value) : 0}%` }} />
                  </div>
                  <p className="text-[13px] text-jf-ink-3">{b.reason}</p>
                </li>
                );
              })}
            </ul>
          </>
        )}
        <p className="text-[13px] text-jf-ink-3">
          {chance
            ? "Estimativa de aderência entre o seu perfil e esta vaga, calculada no seu navegador. Não é a probabilidade real de contratação."
            : "Com o currículo importado, mostramos aqui uma estimativa de aderência entre o seu perfil e esta vaga. Não é a probabilidade real de contratação."}
        </p>
      </section>
      <AiAnalysis key={job.id} job={job} />
    </aside>
  );
}

export function JobDetailView({ job }: { job: JobDetailData }) {
  // Calculado uma vez por vaga carregada: os dados só existem no cliente.
  const [now] = useState(() => Date.now());
  const salary = formatSalary(job);
  // URL bruta da fonte, sem tirar parâmetros (D-07); `urlCanonical` serve só à deduplicação.
  const applyUrl = job.applyUrl ? safeExternalUrl(job.applyUrl) : null;
  const stacks = job.stacks;
  const state = useJobState(job.id);
  // Vaga já favoritada/marcada: a cópia de "Minhas vagas" ganha o link da fonte e os dados novos.
  useEffect(() => {
    syncSnapshots([job]);
  }, [job]);

  return (
    <>
      <BackLink />
      <section className={`${CARD} flex flex-wrap items-start gap-x-6 gap-y-5 p-5 sm:p-7`}>
        <Logo job={job} />
        <div className="flex min-w-0 flex-[999_1_320px] flex-col gap-2.5 sm:basis-[420px]">
          <p className="text-[13px] text-jf-ink-3">
            Publicada {formatAge(job.publishedAt, now)} · coletada de <Attribution items={job.attribution} />
          </p>
          <h1 className="font-display text-[26px] leading-[1.15] font-bold tracking-[-0.01em] break-words sm:text-[32px]">
            {job.title}
          </h1>
          <p className="text-base text-jf-ink-2 sm:text-[17px]">
            {job.company} · {placeLabel(job)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {job.workMode !== "unknown" && <span className={PILL}>{WORK_MODE_LABELS[job.workMode]}</span>}
            {job.seniority && <span className={PILL}>{SENIORITY_LABELS[job.seniority]}</span>}
            <span className={PILL}>{LANGUAGE_LABELS[job.language] ?? job.language.toUpperCase()}</span>
            {salary && <span className={PILL}>{salary}</span>}
            {stacks.map((id, i) => (
              <span
                key={id}
                className={
                  i < 3
                    ? "rounded-full bg-jf-brand-soft px-2.5 py-1 text-[13px] font-semibold text-jf-brand-dark"
                    : "rounded-full border border-jf-line px-2.5 py-1 text-[13px] text-jf-ink-2"
                }
              >
                {STACK_LABEL.get(id) ?? id}
              </span>
            ))}
          </div>
        </div>
        <div className="flex flex-1 basis-full flex-col gap-2.5 sm:basis-[260px]">
          {applyUrl && (
            <a
              href={applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-12 items-center justify-center rounded-xl bg-jf-brand px-4 text-center font-semibold text-white no-underline hover:bg-jf-brand-dark"
            >
              Candidatar na página da vaga <span aria-hidden="true">↗</span>
              <NewTabHint />
            </a>
          )}
          <HardLink
            href={`/gerador/${job.id}`}
            className="flex min-h-12 items-center justify-center rounded-xl border border-jf-line-strong bg-jf-surface px-4 text-center font-semibold text-jf-ink no-underline hover:bg-jf-chip"
          >
            Gerar CV + carta
          </HardLink>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Organizar vaga">
            <FavoriteButton job={job} />
            <StatusSelect job={job} className="flex-1" />
            <HideButton job={job} />
          </div>
          <StatusBadge state={state} />
        </div>
      </section>
      <div className="flex flex-wrap items-start gap-6">
        <Description job={job} />
        <Sidebar job={job} now={now} />
      </div>
    </>
  );
}

export function JobDetail({ id: rawId }: { id: string }) {
  const id = parseJobId(rawId);
  const { data, error, isPending, refetch } = useJob(id);

  if (id === null || error instanceof JobNotFoundError) return <NotFound />;
  if (error) return <LoadError onRetry={() => void refetch()} />;
  if (isPending || !data) return <Skeleton />;
  return <JobDetailView job={data} />;
}
