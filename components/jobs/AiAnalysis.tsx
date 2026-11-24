"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { aiFailure } from "@/components/ai/messages";
import { BTN_OUTLINE, BTN_PRIMARY, CARD } from "@/components/ui/styles";
import { NoProviderCta } from "@/components/settings/NoProviderCta";
import { AiError, isAbortError } from "@/lib/client/ai/errors";
import { hasUsableProvider } from "@/lib/client/ai/model";
import { PROVIDERS } from "@/lib/client/ai/providers";
import { aiSettingsStore } from "@/lib/client/ai/settings";
import { analysisStore, type AnalysisRecord } from "@/lib/client/jobs/analysis-store";
import { profileStore } from "@/lib/client/profile/store";
import { useStore } from "@/lib/client/storage/store";
import type { JobDetail } from "@/lib/shared/types/job";

/** Teto da chamada: o critério de aceite é 30 s; a folga cobre modelos lentos antes de desistir. */
const ANALYSIS_TIMEOUT_MS = 90_000;

type Failure = { text: string; retry: boolean; settingsLink: boolean };

/** Erros que só se resolvem em Configurações: repetir a chamada não adianta. */
const NEEDS_SETTINGS = new Set(["invalid_key", "blocked_by_privacy", "data_policy"]);

const failureOf = (e: unknown): Failure => {
  if (e instanceof AiError) {
    return {
      text: aiFailure(e, {
        noProvider: "Conecte uma IA em Configurações para analisar a vaga.",
        truncated: "A resposta da IA foi cortada. Tente de novo.",
        fallback: "Não foi possível analisar a vaga.",
      }),
      // `no_credit` é exceção explícita: a pessoa pode recarregar e tentar de novo.
      retry: e.retryable || e.code === "no_credit",
      settingsLink: NEEDS_SETTINGS.has(e.code),
    };
  }
  return { text: "Algo deu errado ao analisar a vaga. Tente de novo.", retry: true, settingsLink: false };
};

/** Tudo aqui é texto: a saída da IA nunca vira HTML. */
function Result({ r }: { r: AnalysisRecord }) {
  const provider = PROVIDERS[r.provider as keyof typeof PROVIDERS]?.label ?? r.provider;
  return (
    <>
      <p className="text-[13px] text-jf-ink-3">
        Nota revisada: <strong className="text-jf-ink">{r.revisedScore}</strong>
      </p>
      <div>
        <h3 className="mb-1.5 text-sm font-semibold text-jf-brand-dark">Pontos fortes</h3>
        {r.strengths.length > 0 ? (
          <ul className="list-disc pl-[18px] text-sm leading-relaxed">
            {r.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-jf-ink-3">Nenhum ponto forte identificado.</p>
        )}
      </div>
      <div>
        <h3 className="mb-1.5 text-sm font-semibold text-[#7A4500]">Lacunas</h3>
        {r.gaps.length > 0 ? (
          <ul className="list-disc pl-[18px] text-sm leading-relaxed">
            {r.gaps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-jf-ink-3">Nenhuma lacuna identificada.</p>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Palavras-chave que faltam no CV</h3>
        {r.missingKeywords.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {r.missingKeywords.map((k, i) => (
              <li key={i} className="rounded-full border border-jf-line px-2.5 py-1 text-[13px]">
                {k}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-jf-ink-3">Nenhuma palavra-chave faltando.</p>
        )}
      </div>
      <p className="text-xs text-jf-ink-3">
        Gerada com {r.model} via {provider}
      </p>
    </>
  );
}

/**
 * Análise com IA sob demanda (RF-16, US-05). O resultado salvo e o perfil vêm do localStorage:
 * `useStore` devolve null até a hidratação, então a página estática não gera mismatch.
 */
export function AiAnalysis({ job }: { job: JobDetail }) {
  const profile = useStore(profileStore);
  const settings = useStore(aiSettingsStore);
  const saved = useStore(analysisStore);
  const abortRef = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  // Resultado da sessão: mantém a análise visível mesmo que a gravação falhe.
  const [fresh, setFresh] = useState<{ jobId: number; record: AnalysisRecord } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  // Sair da página ou trocar de vaga cancela a chamada em andamento.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      setRunning(false);
    };
  }, [job.id]);

  const run = useCallback(async () => {
    if (abortRef.current || !profile || !settings) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setFailure(null);
    setSaveFailed(false);
    try {
      const { analyzeJob } = await import("@/lib/client/jobs/analyze");
      const { record, saved: result } = await analyzeJob({
        job,
        profile,
        settings,
        signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(ANALYSIS_TIMEOUT_MS)]),
      });
      if (ctrl.signal.aborted) return;
      setFresh({ jobId: job.id, record });
      setSaveFailed(!result.ok);
    } catch (e) {
      if (ctrl.signal.aborted || isAbortError(e)) return;
      setFailure(failureOf(e));
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setRunning(false);
      }
    }
  }, [job, profile, settings]);

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setFailure(null);
  };

  const record = (fresh?.jobId === job.id ? fresh.record : null) ?? saved?.[String(job.id)] ?? null;
  const hasProvider = settings !== null && hasUsableProvider(settings, "analyze");

  return (
    <section aria-labelledby="ia-t" className={`${CARD} flex flex-col gap-3.5 p-5 sm:p-6`}>
      <h2 id="ia-t" className="text-lg font-semibold">
        Análise com IA
      </h2>

      {record && <Result r={record} />}

      {running && (
        <p role="status" className="text-sm text-jf-ink-2">
          Analisando a vaga com a sua IA. Isso costuma levar alguns segundos.
        </p>
      )}
      {saveFailed && (
        <p role="alert" className="text-[13px] text-jf-ink-2">
          Não foi possível salvar
        </p>
      )}
      {failure && (
        <div role="alert" className="flex flex-col gap-2 rounded-xl border border-jf-line-strong p-3 text-sm">
          <p>{failure.text}</p>
          {failure.retry && (
            <button type="button" className={`${BTN_OUTLINE} self-start`} onClick={() => void run()} disabled={running}>
              Tentar de novo
            </button>
          )}
          {failure.settingsLink && (
            <Link href="/configuracoes" className={`${BTN_OUTLINE} self-start no-underline`}>
              Abrir Configurações
            </Link>
          )}
        </div>
      )}

      {!record && !profile && (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-jf-ink-3">
            Importe o seu currículo para ver pontos fortes, lacunas e palavras-chave que faltam para esta vaga.
          </p>
          <Link href="/perfil" className={`${BTN_PRIMARY} w-fit no-underline`}>
            Importar currículo
          </Link>
        </div>
      )}

      {profile && !hasProvider && settings !== null && <NoProviderCta task="analyze" />}

      {profile && hasProvider && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={record ? BTN_OUTLINE : BTN_PRIMARY}
            onClick={() => void run()}
            disabled={running}
          >
            {running ? "Analisando…" : record ? "Analisar de novo" : "Analisar com IA"}
          </button>
          {running && (
            <button type="button" className={BTN_OUTLINE} onClick={cancel}>
              Cancelar
            </button>
          )}
        </div>
      )}

      {!record && profile && hasProvider && !running && (
        <p className="text-[13px] text-jf-ink-3">
          Pontos fortes, lacunas e palavras-chave que faltam no seu currículo para esta vaga, geradas com a chave de IA
          que você configurou. O texto da vaga e o seu perfil, sem e-mail, telefone nem endereço, vão direto do seu
          navegador ao provedor; nada passa pelo nosso servidor.
        </p>
      )}
    </section>
  );
}
