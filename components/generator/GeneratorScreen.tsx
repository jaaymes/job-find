"use client";

import { Download } from "lucide-react";
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
import { useJobStates } from "@/lib/client/jobs/job-state";
import { useMediaQuery } from "@/lib/client/use-media-query";
import { safeExternalUrl } from "@/lib/shared/safe-url";
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
import { HardLink } from "@/components/ui/hard-link";
import { Skeleton } from "@/components/ui/skeleton";

/** Teto da chamada: o critério de aceite é 60 s; a folga cobre modelos lentos antes de desistir. */
const GENERATE_TIMEOUT_MS = 120_000;
const MAX_PAGES = 2;
/** Espera sem digitar antes de gravar as edições no localStorage (o estado em memória é imediato). */
const SAVE_DEBOUNCE_MS = 300;

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

type MobileView = "edit" | "preview";
const VIEWS: { id: MobileView; label: string }[] = [
  { id: "edit", label: "Editar" },
  { id: "preview", label: "Pré-visualizar" },
];
const viewTab = (id: MobileView) => `gerador-modo-${id}`;
const VIEW_PANEL = "gerador-modo-painel";

/** Abas Editar / Pré-visualizar (abaixo de `lg`), com sublinhado de 2px na aba ativa e setas do teclado. */
function ViewTabs({ view, onView }: { view: MobileView; onView: (v: MobileView) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, index: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0 && e.key !== "Home" && e.key !== "End") return;
    const target = e.key === "Home" ? 0 : e.key === "End" ? VIEWS.length - 1 : (index + step + VIEWS.length) % VIEWS.length;
    e.preventDefault();
    refs.current[target]?.focus();
    onView(VIEWS[target].id);
  };
  return (
    <div role="tablist" aria-label="Modo" className="-mx-4 flex border-b border-jf-line bg-jf-surface px-4 pt-2 sm:-mx-6 sm:px-6">
      {VIEWS.map((v, i) => (
        <button
          key={v.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          id={viewTab(v.id)}
          aria-selected={view === v.id}
          aria-controls={VIEW_PANEL}
          tabIndex={view === v.id ? 0 : -1}
          onClick={() => onView(v.id)}
          onKeyDown={(e) => onKey(e, i)}
          className={`min-h-11 flex-1 border-b-2 text-[15px] outline-none focus-visible:ring-2 focus-visible:ring-jf-brand focus-visible:ring-inset ${
            view === v.id ? "border-jf-brand font-semibold text-jf-ink" : "border-transparent font-medium text-jf-ink-2"
          }`}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

/** Barra de ação fixa do gerador no celular: "Gerar de novo" e "Baixar PDF". Some com o teclado aberto. */
function MobileActionBar({
  canGenerate,
  busy,
  downloading,
  downloadDisabled,
  onGenerate,
  onDownload,
}: {
  canGenerate: boolean;
  busy: boolean;
  downloading: boolean;
  downloadDisabled: boolean;
  onGenerate: () => void;
  onDownload: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Ações do documento"
      className="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t border-jf-line bg-jf-surface px-4 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(21,23,28,0.08)] lg:hidden [body:has(input:focus,textarea:focus,select:focus)_&]:hidden"
    >
      {canGenerate && (
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy}
          className="inline-flex min-h-13 flex-none items-center justify-center rounded-xl border border-jf-field-border bg-jf-surface px-4 text-[15px] font-semibold text-jf-ink outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-jf-brand disabled:opacity-60"
        >
          Gerar de novo
        </button>
      )}
      <button
        type="button"
        onClick={onDownload}
        disabled={downloading || downloadDisabled}
        className="inline-flex min-h-13 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl bg-jf-brand px-3 text-base font-semibold text-jf-on-brand outline-none hover:bg-jf-brand-dark focus-visible:ring-2 focus-visible:ring-jf-brand focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Download aria-hidden="true" className="size-[18px]" />
        Baixar PDF
      </button>
    </div>
  );
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
  // Edições que existiam quando a última geração começou (já confirmadas): uma edição nova pede nova confirmação.
  const [lastSnap, setLastSnap] = useState("null");
  const pendingRef = useRef<GeneratedRecord | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirm, setConfirm] = useState<RunArgs | null>(null);
  const [draft, setDraft] = useState<RunArgs>(() => ({ lang: pickLanguage(job), includeLetter: false }));
  // Cópia da sessão: mantém tudo na tela mesmo que a gravação falhe (cota cheia).
  const [fresh, setFresh] = useState<{ jobId: number; record: GeneratedRecord } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [tab, setTab] = useState<EditorTab>("cv");
  const [pages, setPages] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const wide = useMediaQuery("(min-width: 1024px)");
  const [view, setView] = useState<MobileView>("edit");

  /** Grava no localStorage o último estado pendente (as edições são gravadas com atraso). */
  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const r = pendingRef.current;
    if (!r) return;
    pendingRef.current = null;
    const res = generatedStore.set({ ...generatedStore.get(), [String(job.id)]: r });
    setSaveFailed(!res.ok);
  }, [job.id]);

  // Sair da página ou trocar de vaga cancela a chamada em andamento e grava o que ficou pendente.
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [job.id, flush]);

  const record = (fresh?.jobId === job.id ? fresh.record : null) ?? saved?.[String(job.id)] ?? null;
  const docs = useMemo(() => (record ? docsOf(record) : null), [record]);
  const review = useMemo(
    () => (profile && record && docs ? reviewDocs(profile, docs, record.lang, record.approvedFlags, job) : null),
    [profile, record, docs, job],
  );

  const write = (next: GeneratedRecord) => {
    setFresh({ jobId: job.id, record: next });
    pendingRef.current = next;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  };
  const update = (fn: (r: GeneratedRecord) => GeneratedRecord) => {
    if (record) write(fn(record));
  };

  const run = useCallback(
    async (args: RunArgs, snap: string) => {
      if (abortRef.current || !profile || !settings) return;
      flush();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setRunning(args);
      setLastRun(args);
      setLastSnap(snap);
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
        setView("preview");
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
    [job, profile, settings, flush],
  );

  // Trabalho do usuário que uma nova geração descarta: edições e aprovações ("Aprovar mesmo assim").
  const hasUserWork = !!record?.edits || (record?.approvedFlags.length ?? 0) > 0;
  const editsSnap = JSON.stringify([record?.edits ?? null, record?.approvedFlags ?? []]);

  /** Refazer a geração descarta edições e aprovações: pede confirmação antes, só quando há alguma. */
  const request = (args: RunArgs) => {
    if (running) return;
    if (hasUserWork) setConfirm(args);
    else void run(args, editsSnap);
  };

  /** Tentar de novo: se há edições/aprovações que a confirmação anterior não cobria, pergunta de novo. */
  const retry = () => {
    if (!lastRun || running) return;
    if (hasUserWork && editsSnap !== lastSnap) setConfirm(lastRun);
    else void run(lastRun, editsSnap);
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
      <div className="flex items-center gap-1 lg:flex-col lg:items-stretch lg:gap-5">
        <Link
          href={`/vagas/${job.id}`}
          className="inline-flex size-11 flex-none items-center justify-center gap-1.5 text-jf-ink no-underline outline-none focus-visible:ring-2 focus-visible:ring-jf-brand lg:size-auto lg:min-h-11 lg:justify-start lg:self-start lg:text-sm lg:text-jf-brand lg:hover:text-jf-brand-dark"
        >
          <span aria-hidden="true" className="text-xl lg:text-sm">
            ←
          </span>
          <span className="sr-only lg:not-sr-only">Voltar para a vaga</span>
        </Link>
        <header className="flex min-w-0 flex-col gap-0.5 lg:gap-1">
          <h1 className="font-display text-base leading-tight font-bold sm:text-lg lg:text-3xl">Gerador de CV e carta</h1>
          <p className="truncate text-xs text-jf-ink-2 lg:text-[15px]">
            {job.title} · {job.company}
          </p>
        </header>
      </div>

      {settings === null ? (
        <Skeleton className={`${CARD} h-40`} />
      ) : !profile ? (
        <section className={`${CARD} flex flex-col items-start gap-3 p-6`}>
          <p className="text-[15px] text-jf-ink-2">
            Importe o seu currículo para gerar um CV e uma carta adaptados a esta vaga. Só usamos fatos do seu perfil.
          </p>
          <HardLink href="/perfil" className={`${BTN_PRIMARY} no-underline`}>
            Importar currículo
          </HardLink>
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
                <button type="button" className={BTN_PRIMARY} onClick={() => void run(confirm, editsSnap)}>
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
                  <button type="button" className={BTN_OUTLINE} onClick={retry} disabled={running !== null}>
                    Tentar de novo
                  </button>
                )}
                {failure.settingsLink && (
                  <HardLink href="/configuracoes" className={`${BTN_OUTLINE} no-underline`}>
                    Abrir Configurações
                  </HardLink>
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
                  <p role="status" className="rounded-xl border border-jf-warn-line bg-jf-new-bg px-4 py-3 text-sm text-jf-new-fg">
                    O CV passou de {MAX_PAGES} páginas ({pages}). Remova ou encurte trechos para ficar mais fácil de ler na
                    triagem.
                  </p>
                )}
                {!wide && <ViewTabs view={view} onView={setView} />}
                <div
                  role={wide ? undefined : "tabpanel"}
                  id={wide ? undefined : VIEW_PANEL}
                  aria-labelledby={wide ? undefined : viewTab(view)}
                  className="grid items-start gap-5 lg:grid-cols-2"
                >
                  {(wide || view === "edit") && (
                    <div className="flex flex-col gap-5">
                      <TailoredEditor
                        key={record.createdAt}
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
                  )}
                  {(wide || view === "preview") && (
                    <div className="flex flex-col gap-3 lg:sticky lg:top-4">
                      {!wide && showLetterTab && (
                        <div role="group" aria-label="Documento" className="flex gap-2">
                          {(["cv", "letter"] as const).map((t) => (
                            <button
                              key={t}
                              type="button"
                              aria-pressed={activeTab === t}
                              onClick={() => setTab(t)}
                              className={`inline-flex min-h-11 items-center rounded-full border px-4 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-jf-brand ${
                                activeTab === t
                                  ? "border-jf-brand bg-jf-chip font-semibold text-jf-brand-dark"
                                  : "border-jf-line bg-jf-surface font-medium text-jf-ink-2"
                              }`}
                            >
                              {t === "cv" ? "Currículo" : "Carta"}
                            </button>
                          ))}
                        </div>
                      )}
                      {activeTab === "letter" && review.letter.flagged ? (
                        <div
                          role="status"
                          className="flex h-[70vh] min-h-[420px] w-full items-center justify-center rounded-xl border border-jf-line bg-jf-surface p-6 text-center text-sm text-jf-ink-3"
                        >
                          Aprove ou corrija o trecho da carta para ver o PDF.
                        </div>
                      ) : (
                        <PdfPreview
                          cv={review.cv}
                          letter={activeTab === "letter" ? docs.coverLetter : null}
                          onPages={setPages}
                        />
                      )}
                    </div>
                  )}
                </div>
                {!wide && (
                  <>
                    <div aria-hidden="true" className="h-14" />
                    <MobileActionBar
                      canGenerate={hasProvider}
                      busy={running !== null}
                      downloading={downloading}
                      downloadDisabled={activeTab === "letter" && review.letter.flagged}
                      onGenerate={() => request({ lang: record.lang, includeLetter: shown.includeLetter })}
                      onDownload={() => void download(activeTab)}
                    />
                  </>
                )}
              </>
            )
          )}
        </>
      )}
    </>
  );
}

function NotFound({ id }: { id: number | null }) {
  const states = useJobStates();
  const snapshot = id === null ? undefined : states?.[String(id)]?.snapshot;
  // Antes da hidratação o estado ainda não foi lido: evita piscar "Vaga não encontrada".
  if (states === null && id !== null) return <Skeleton className={`${CARD} h-40`} />;
  // Vaga que o usuário marcou e que saiu do índice: sem a descrição não há o que adaptar ao CV.
  if (snapshot) {
    const source = safeExternalUrl(snapshot.urlCanonical);
    return (
      <section className={`${CARD} flex flex-col items-start gap-3 p-6 sm:p-8`}>
        <h1 className="font-display text-2xl font-bold sm:text-3xl">{snapshot.title}</h1>
        <p className="text-[15px] text-jf-ink-2">
          {snapshot.company}. Esta vaga saiu do índice. Sem a descrição não dá para gerar o CV.
        </p>
        <div className="flex flex-wrap gap-2">
          {source && (
            <a href={source} target="_blank" rel="noopener noreferrer nofollow" className={`${BTN_OUTLINE} no-underline`}>
              Ver a vaga na fonte <span aria-hidden="true">&nbsp;↗</span>
              <span className="sr-only"> (abre em nova aba)</span>
            </a>
          )}
          <HardLink href="/minhas-vagas" className={`${BTN_PRIMARY} no-underline`}>
            Voltar para Minhas vagas
          </HardLink>
        </div>
      </section>
    );
  }
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
  if (id === null || error instanceof JobNotFoundError) return <NotFound id={id} />;
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
  if (isPending || !data) return <Skeleton label="Carregando a vaga" className={`${CARD} h-56`} />;
  return <Generator key={data.id} job={data} />;
}
