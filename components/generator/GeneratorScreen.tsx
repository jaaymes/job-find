"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aiFailure } from "@/components/ai/messages";
import { NoProviderCta } from "@/components/settings/NoProviderCta";
import { BTN_OUTLINE, BTN_PRIMARY, CARD } from "@/components/ui/styles";
import { AiError, isAbortError } from "@/lib/client/ai/errors";
import { hasUsableProvider } from "@/lib/client/ai/model";
import { pickLanguage } from "@/lib/client/ai/prompts/cv.tailor.v1";
import { aiSettingsStore } from "@/lib/client/ai/settings";
import { docsOf, generatedStore, type GeneratedRecord } from "@/lib/client/cv/generated-store";
import type { CvLang } from "@/lib/client/cv/period";
import { reviewDocs } from "@/lib/client/cv/review";
import { JobNotFoundError, parseJobId, useJob } from "@/lib/client/jobs/use-job";
import { cvFileName } from "@/lib/client/pdf/filename";
import { profileStore } from "@/lib/client/profile/store";
import { useStore } from "@/lib/client/storage/store";
import type { TailoredDocs } from "@/lib/shared/schemas/tailored";
import type { JobDetail } from "@/lib/shared/types/job";
import { GapsPanel } from "./GapsPanel";
import { GeneratorToolbar } from "./GeneratorToolbar";
import { PdfPreview } from "./PdfPreview";
import { ReviewBanner } from "./ReviewBanner";
import { type EditorTab, TailoredEditor } from "./TailoredEditor";

/** Teto da chamada: o critério de aceite é 60 s; a folga cobre modelos lentos antes de desistir. */
const GENERATE_TIMEOUT_MS = 120_000;
const MAX_PAGES = 2;

type RunArgs = { lang: CvLang; includeLetter: boolean };
type Failure = { text: string; retry: boolean; settingsLink: boolean };

/** Erros que só se resolvem em Configurações: repetir a chamada não adianta. */
const NEEDS_SETTINGS = new Set(["invalid_key", "blocked_by_privacy", "data_policy"]);

const failureOf = (e: unknown): Failure => {
  if (e instanceof AiError) {
    return {
      text: aiFailure(e, {
        noProvider: "Conecte uma IA em Configurações para gerar o CV.",
        truncated: "A resposta da IA foi cortada. Tente de novo.",
        fallback: "Não foi possível gerar o CV.",
      }),
      retry: e.retryable || e.code === "no_credit",
      settingsLink: NEEDS_SETTINGS.has(e.code),
    };
  }
  return { text: "Algo deu errado ao gerar o CV. Tente de novo.", retry: true, settingsLink: false };
};

const isText = (v: unknown): v is string => typeof v === "string";

/** Lê o JSON parcial do stream sem confiar no formato: só strings viram texto. */
function readPartial(p: unknown): { headline: string; summary: string; skills: string[]; bullets: string[]; letter: string } {
  const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {});
  const root = obj(p);
  const cv = obj(root.cv);
  const exps = Array.isArray(cv.experiences) ? cv.experiences : [];
  return {
    headline: isText(cv.headline) ? cv.headline : "",
    summary: isText(cv.summary) ? cv.summary : "",
    skills: Array.isArray(cv.skills) ? cv.skills.filter(isText) : [],
    bullets: exps.flatMap((e) => {
      const b = obj(e).bullets;
      return Array.isArray(b) ? b.map((x) => obj(x).text).filter(isText) : [];
    }),
    letter: isText(root.coverLetter) ? root.coverLetter : "",
  };
}

/** Tudo aqui é texto: a saída da IA nunca vira HTML. */
function StreamingPreview({ partial }: { partial: unknown }) {
  const p = readPartial(partial);
  return (
    <section aria-label="Geração em andamento" className={`${CARD} flex flex-col gap-3 p-5 text-sm`}>
      {p.headline && <p className="text-lg font-semibold">{p.headline}</p>}
      {p.summary && <p className="leading-relaxed">{p.summary}</p>}
      {p.skills.length > 0 && <p className="text-jf-ink-2">{p.skills.join(" · ")}</p>}
      {p.bullets.length > 0 && (
        <ul className="list-disc pl-[18px] leading-relaxed">
          {p.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {p.letter && <p className="leading-relaxed whitespace-pre-line text-jf-ink-2">{p.letter}</p>}
    </section>
  );
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Generator({ job }: { job: JobDetail }) {
  const profile = useStore(profileStore);
  const settings = useStore(aiSettingsStore);
  const saved = useStore(generatedStore);
  const abortRef = useRef<AbortController | null>(null);
  const [running, setRunning] = useState<RunArgs | null>(null);
  const [partial, setPartial] = useState<unknown>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [lastRun, setLastRun] = useState<RunArgs | null>(null);
  const [confirm, setConfirm] = useState<RunArgs | null>(null);
  const [draft, setDraft] = useState<RunArgs>(() => ({ lang: pickLanguage(job), includeLetter: false }));
  // Cópia da sessão: mantém tudo na tela mesmo que a gravação falhe (cota cheia).
  const [fresh, setFresh] = useState<{ jobId: number; record: GeneratedRecord } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [tab, setTab] = useState<EditorTab>("cv");
  const [pages, setPages] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  // Sair da página ou trocar de vaga cancela a chamada em andamento.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [job.id]);

  const record = (fresh?.jobId === job.id ? fresh.record : null) ?? saved?.[String(job.id)] ?? null;
  const docs = useMemo(() => (record ? docsOf(record) : null), [record]);
  const review = useMemo(
    () => (profile && record && docs ? reviewDocs(profile, docs, record.lang, record.approvedFlags, job) : null),
    [profile, record, docs, job],
  );

  const write = (next: GeneratedRecord) => {
    setFresh({ jobId: job.id, record: next });
    const res = generatedStore.set({ ...generatedStore.get(), [String(job.id)]: next });
    setSaveFailed(!res.ok);
  };
  const update = (fn: (r: GeneratedRecord) => GeneratedRecord) => {
    if (record) write(fn(record));
  };

  const run = useCallback(
    async (args: RunArgs) => {
      if (abortRef.current || !profile || !settings) return;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setRunning(args);
      setLastRun(args);
      setPartial(null);
      setFailure(null);
      setConfirm(null);
      setSaveFailed(false);
      try {
        const { generateDocs } = await import("@/lib/client/cv/generate");
        const { record: next, saved: result } = await generateDocs({
          job,
          profile,
          settings,
          ...args,
          signal: AbortSignal.any([ctrl.signal, AbortSignal.timeout(GENERATE_TIMEOUT_MS)]),
          onPartial: (p) => {
            if (!ctrl.signal.aborted) setPartial(p);
          },
        });
        if (ctrl.signal.aborted) return;
        setFresh({ jobId: job.id, record: next });
        setSaveFailed(!result.ok);
        setDraft(args);
        setTab("cv");
        setPages(null);
      } catch (e) {
        if (ctrl.signal.aborted || isAbortError(e)) return;
        // Falhou: o registro anterior (e as edições) continua na tela e no armazenamento.
        setFailure(failureOf(e));
      } finally {
        if (abortRef.current === ctrl) {
          abortRef.current = null;
          setRunning(null);
          setPartial(null);
        }
      }
    },
    [job, profile, settings],
  );

  /** Refazer a geração descarta as edições: pede confirmação antes, só quando há edições. */
  const request = (args: RunArgs) => {
    if (running) return;
    if (record?.edits) setConfirm(args);
    else void run(args);
  };

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(null);
    setPartial(null);
    setFailure(null);
  };

  const current: RunArgs = record ? { lang: record.lang, includeLetter: record.includeLetter } : draft;
  const shown = confirm ?? running ?? current;

  const onLang = (lang: CvLang) => {
    if (!record) setDraft({ ...draft, lang });
    else if (lang !== record.lang) request({ lang, includeLetter: record.includeLetter });
  };
  const onLetter = (includeLetter: boolean) => {
    if (!record) setDraft({ ...draft, includeLetter });
    else if (!includeLetter || record.coverLetter !== null) update((r) => ({ ...r, includeLetter }));
    else request({ lang: record.lang, includeLetter: true });
  };

  const download = async (kind: "cv" | "letter") => {
    if (!profile || !record || !docs || !review) return;
    setDownloading(true);
    setDownloadFailed(false);
    try {
      const render = await import("@/lib/client/pdf/render");
      const name = cvFileName(profile.name ?? "", job.company, job.title);
      if (kind === "letter") {
        if (docs.coverLetter === null || review.letter.flagged) return;
        saveBlob((await render.renderLetterPdf(docs.coverLetter, review.cv)).blob, name.replace(/^CV/, "Carta"));
      } else {
        saveBlob((await render.renderCvPdf(review.cv)).blob, name);
      }
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  };

  const hasProvider = settings !== null && hasUsableProvider(settings, "cv");
  const showLetterTab = !!record?.includeLetter && docs?.coverLetter != null;
  const activeTab: EditorTab = tab === "letter" && showLetterTab ? "letter" : "cv";
  const onChange = (next: TailoredDocs) => update((r) => ({ ...r, edits: next }));
  const onApprove = (key: string) =>
    update((r) => (r.approvedFlags.includes(key) ? r : { ...r, approvedFlags: [...r.approvedFlags, key] }));

  return (
    <>
      <Link href={`/vagas/${job.id}`} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm text-jf-brand no-underline hover:text-jf-brand-dark">
        <span aria-hidden="true">←</span> Voltar para a vaga
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Gerador de CV e carta</h1>
        <p className="text-[15px] text-jf-ink-2">
          {job.title} · {job.company}
        </p>
      </header>

      {settings === null ? (
        <div role="status" aria-label="Carregando" className={`${CARD} h-40 animate-pulse`} />
      ) : !profile ? (
        <section className={`${CARD} flex flex-col items-start gap-3 p-6`}>
          <p className="text-[15px] text-jf-ink-2">
            Importe o seu currículo para gerar um CV e uma carta adaptados a esta vaga. Só usamos fatos do seu perfil.
          </p>
          <Link href="/perfil" className={`${BTN_PRIMARY} no-underline`}>
            Importar currículo
          </Link>
        </section>
      ) : (
        <>
          {!hasProvider && <NoProviderCta task="cv" />}
          <GeneratorToolbar
            lang={shown.lang}
            includeLetter={shown.includeLetter}
            hasDocs={record !== null}
            running={running !== null}
            canGenerate={hasProvider}
            letterAvailable={showLetterTab}
            letterBlocked={review?.letter.flagged ?? false}
            downloading={downloading}
            onLang={onLang}
            onLetter={onLetter}
            onGenerate={() => request(record ? { lang: record.lang, includeLetter: shown.includeLetter } : draft)}
            onCancel={cancel}
            onDownloadCv={() => void download("cv")}
            onDownloadLetter={() => void download("letter")}
          />

          {confirm && (
            <div role="alert" className="flex flex-col gap-2.5 rounded-xl border border-jf-line-strong bg-jf-surface p-4 text-sm">
              <p>
                <strong>Suas edições serão descartadas.</strong> Gerar de novo troca o texto por um novo, sem as edições e
                aprovações que você fez.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={BTN_PRIMARY} onClick={() => void run(confirm)}>
                  Descartar e gerar
                </button>
                <button type="button" className={BTN_OUTLINE} onClick={() => setConfirm(null)}>
                  Manter edições
                </button>
              </div>
            </div>
          )}

          {running && (
            <p role="status" className="text-sm text-jf-ink-2">
              Gerando o CV com a sua IA. Isso costuma levar alguns segundos.
            </p>
          )}
          {failure && (
            <div role="alert" className="flex flex-col gap-2 rounded-xl border border-jf-line-strong p-3 text-sm">
              <p>{failure.text}</p>
              {record && <p className="text-jf-ink-3">O texto que você já tinha continua aqui, com as suas edições.</p>}
              <div className="flex flex-wrap gap-2">
                {failure.retry && lastRun && (
                  <button type="button" className={BTN_OUTLINE} onClick={() => void run(lastRun)} disabled={running !== null}>
                    Tentar de novo
                  </button>
                )}
                {failure.settingsLink && (
                  <Link href="/configuracoes" className={`${BTN_OUTLINE} no-underline`}>
                    Abrir Configurações
                  </Link>
                )}
              </div>
            </div>
          )}
          {saveFailed && (
            <p role="alert" className="text-[13px] text-jf-ink-2">
              Não foi possível salvar no navegador. Baixe o PDF antes de sair da página.
            </p>
          )}
          {downloadFailed && (
            <p role="alert" className="text-[13px] text-jf-danger-fg">
              Não foi possível gerar o PDF. Tente de novo.
            </p>
          )}

          {running ? (
            partial !== null && <StreamingPreview partial={partial} />
          ) : (
            record &&
            docs &&
            review && (
              <>
                <ReviewBanner count={review.flaggedCount} removedExperiences={review.removedExperiences} />
                {pages !== null && pages > MAX_PAGES && activeTab === "cv" && (
                  <p role="status" className="rounded-xl border border-[#E0B060] bg-jf-new-bg px-4 py-3 text-sm text-jf-new-fg">
                    O CV passou de {MAX_PAGES} páginas ({pages}). Remova ou encurte trechos para ficar mais fácil de ler na
                    triagem.
                  </p>
                )}
                <div className="grid items-start gap-5 lg:grid-cols-2">
                  <div className="flex flex-col gap-5">
                    <TailoredEditor
                      docs={docs}
                      review={review}
                      tab={activeTab}
                      showLetterTab={showLetterTab}
                      onTab={setTab}
                      onChange={onChange}
                      onApprove={onApprove}
                    />
                    <GapsPanel
                      violations={review.violations}
                      approvedFlags={record.approvedFlags}
                      removedExperiences={review.removedExperiences}
                    />
                    <p className="text-xs text-jf-ink-3">
                      Gerado com {record.model} via {record.provider}. Tudo fica só no seu navegador.
                    </p>
                  </div>
                  <div className="lg:sticky lg:top-4">
                    <PdfPreview
                      cv={review.cv}
                      letter={activeTab === "letter" ? docs.coverLetter : null}
                      onPages={setPages}
                    />
                  </div>
                </div>
              </>
            )
          )}
        </>
      )}
    </>
  );
}

function NotFound() {
  return (
    <section className={`${CARD} flex flex-col items-start gap-3 p-6 sm:p-8`}>
      <h1 className="font-display text-2xl font-bold sm:text-3xl">Vaga não encontrada</h1>
      <p className="text-[15px] text-jf-ink-2">Ela pode ter sido encerrada ou o endereço está incorreto.</p>
      <Link href="/" className={`${BTN_PRIMARY} no-underline`}>
        Ver todas as vagas
      </Link>
    </section>
  );
}

export function GeneratorScreen({ jobId }: { jobId: string }) {
  const id = parseJobId(jobId);
  const { data, error, isPending, refetch } = useJob(id);
  if (id === null || error instanceof JobNotFoundError) return <NotFound />;
  if (error) {
    return (
      <section role="alert" className={`${CARD} flex flex-col items-start gap-3 p-6`}>
        <h1 className="font-display text-2xl font-bold">Não foi possível carregar a vaga</h1>
        <button type="button" className={BTN_OUTLINE} onClick={() => void refetch()}>
          Tentar de novo
        </button>
      </section>
    );
  }
  if (isPending || !data) return <div role="status" aria-label="Carregando a vaga" className={`${CARD} h-56 animate-pulse`} />;
  return <Generator key={data.id} job={data} />;
}
