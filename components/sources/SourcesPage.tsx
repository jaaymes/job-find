"use client";

import { formatAge, formatCollectedAt, isSourceStale, staleAfterHours } from "@/components/jobs/format";
import { useSourcesStatus } from "@/lib/client/sources/use-sources-status";
import type { SourceStatus } from "@/lib/shared/types/sources-status";

const BADGE = "rounded-full px-2.5 py-0.5 text-xs font-semibold";

function isStale(source: SourceStatus, now: number | null): boolean {
  return now !== null && isSourceStale(source.lastSuccessAt, source.status === "failing", now, source.staleAfterMinutes * 60_000);
}

/** `allStale`: o banner global já avisa, então a linha não repete o alerta de coleta parada. */
function SourceRow({ source, now, allStale }: { source: SourceStatus; now: number | null; allStale: boolean }) {
  const failing = source.status === "failing";
  const stale = isStale(source, now);
  const collected = source.lastSuccessAt ? formatCollectedAt(source.lastSuccessAt) : null;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-jf-line bg-jf-surface px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          aria-hidden="true"
          className={`size-2.5 shrink-0 rounded-full ${failing || stale ? "bg-jf-new-fg" : "bg-jf-alta"}`}
        />
        <a
          href={source.attributionUrl}
          target="_blank"
          rel={source.dofollow ? "noopener noreferrer" : "noopener noreferrer nofollow"}
          className="font-display text-[17px] font-bold text-jf-brand underline-offset-2 hover:text-jf-brand-dark hover:underline"
        >
          {source.label}
        </a>
        {failing && <span className={`${BADGE} bg-jf-new-bg text-jf-new-fg`}>Falhando</span>}
      </div>
      <p className="text-sm text-jf-ink-3">
        {source.lastSuccessAt && collected
          ? `Última coleta com sucesso: ${collected.time} de ${collected.date}${now !== null ? ` (${formatAge(source.lastSuccessAt, now)})` : ""}.`
          : "Ainda sem coleta com sucesso."}
      </p>
      {failing && (
        <p className="text-sm text-jf-new-fg">Falhas seguidas nas últimas coletas; os dados desta fonte podem estar desatualizados.</p>
      )}
      {stale && !allStale && (
        <p
          role="status"
          className="rounded-lg border border-jf-new-fg/20 bg-jf-new-bg px-3 py-2 text-sm text-jf-new-fg"
        >
          Coleta parada há mais de {staleAfterHours(source.staleAfterMinutes)} h
        </p>
      )}
    </li>
  );
}

export function SourcesPage() {
  const query = useSourcesStatus();
  // Relógio do cliente = instante em que os dados chegaram (o pré-render não conhece a hora).
  const now = query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null;
  const sources = query.data?.sources ?? [];
  const allStale = sources.length > 0 && sources.every((s) => isStale(s, now));

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <h1 className="font-display text-[28px] leading-tight font-bold">Fontes</h1>
        <p className="max-w-[70ch] text-[15px] text-jf-ink-2">
          O Job Find reúne vagas de tecnologia de fontes públicas. Cada vaga leva o link da fonte de origem, e aqui você
          acompanha se a coleta de cada uma está em dia.
        </p>
      </div>
      {query.isPending && <p className="text-sm text-jf-ink-3">Carregando fontes…</p>}
      {query.isError && (
        <p role="alert" className="text-sm text-jf-new-fg">
          Não foi possível carregar o status das fontes.{" "}
          <button type="button" onClick={() => void query.refetch()} className="underline">
            Tentar de novo
          </button>
        </p>
      )}
      {allStale && (
        <p role="status" className="rounded-lg border border-jf-new-fg/20 bg-jf-new-bg px-4 py-3 text-sm text-jf-new-fg">
          A coleta está atrasada em todas as fontes. As vagas podem estar desatualizadas; a coleta volta ao normal
          sozinha.
        </p>
      )}
      {query.data && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {query.data.sources.map((s) => (
            <SourceRow key={s.source} source={s} now={now} allStale={allStale} />
          ))}
        </ul>
      )}
    </>
  );
}
