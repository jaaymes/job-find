"use client";

import { useEffect, useId, useRef, useState } from "react";
import { isAbortError } from "@/lib/client/ai/errors";
import type { AiSettings } from "@/lib/client/ai/settings";
import { extractText } from "@/lib/client/extract";
import type { Profile } from "@/lib/shared/schemas/profile";
import { toFailure, SCANNED_MESSAGE, type Failure } from "./messages";
import { BTN_OUTLINE, BTN_PRIMARY, CARD, FIELD, FIELD_LABEL } from "@/components/ui/styles";

export type ImportMeta = { source: string; pages: number | null };

type Props = {
  settings: AiSettings;
  /** Sem provedor conectado a IA não roda; o painel fica desabilitado. */
  canUseAi: boolean;
  onImported: (profile: Profile, meta: ImportMeta) => void;
  onManual: () => void;
  hasProfile: boolean;
  lastImport: ImportMeta | null;
};

type Status = "idle" | "reading" | "analyzing";
type Job = { kind: "file"; file: File } | { kind: "text"; text: string };

export function ImportPanel({ settings, canUseAi, onImported, onManual, hasProfile, lastImport }: Props) {
  const fileId = useId();
  const textId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [text, setText] = useState("");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [lastJob, setLastJob] = useState<Job | null>(null);
  const [dragging, setDragging] = useState(false);

  const focusPaste = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);
  // Depois de um PDF escaneado o campo de colar abre e recebe o foco (já montado neste ponto).
  useEffect(() => {
    if (pasteOpen && failure && focusPaste.current) {
      focusPaste.current = false;
      textRef.current?.focus();
    }
  }, [pasteOpen, failure]);

  async function run(job: Job) {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLastJob(job);
    setFailure(null);
    try {
      let cvText: string;
      let meta: ImportMeta;
      if (job.kind === "file") {
        setStatus("reading");
        const r = await extractText(job.file);
        if (ctrl.signal.aborted) return;
        if (r.scanned) {
          setStatus("idle");
          focusPaste.current = true;
          setPasteOpen(true);
          setFailure({ text: SCANNED_MESSAGE, retryable: false });
          return;
        }
        cvText = r.text;
        meta = { source: job.file.name, pages: r.pages };
      } else {
        cvText = job.text;
        meta = { source: "Texto colado", pages: null };
      }
      setStatus("analyzing");
      const { importProfile } = await import("@/lib/client/profile/import");
      const profile = await importProfile(cvText, settings, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setStatus("idle");
      onImported(profile, meta);
    } catch (e) {
      // Execução cancelada ou já substituída por outra: não mexe no estado da nova (o Cancelar já zerou o status).
      if (ctrl.signal.aborted || abortRef.current !== ctrl) return;
      setStatus("idle");
      if (isAbortError(e)) return;
      setFailure(toFailure(e));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const busy = status !== "idle";
  const disabled = busy || !canUseAi;

  function pick(file: File | undefined) {
    if (file && !disabled) void run({ kind: "file", file });
  }

  return (
    <section aria-labelledby="imp-t" className="flex flex-col gap-4">
      <div className={`${CARD} flex flex-col gap-3.5 p-5 sm:p-[22px]`}>
        <h2 id="imp-t" className="text-lg font-semibold">
          Importar currículo
        </h2>
        <label
          htmlFor={fileId}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files[0]);
          }}
          className={`relative flex min-h-11 cursor-pointer flex-col items-center gap-2 rounded-[14px] border-2 border-dashed px-4 py-7 text-center focus-within:ring-2 focus-within:ring-jf-brand ${
            dragging ? "border-jf-brand bg-jf-brand-soft" : "border-jf-line-strong bg-[#fbfaf8]"
          } ${disabled ? "opacity-60" : ""}`}
        >
          <svg aria-hidden="true" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-jf-ink-2">
            <path d="M12 15V4M7 9l5-5 5 5" />
            <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
          </svg>
          <span className="font-semibold">Arraste o arquivo ou clique para escolher</span>
          <span className="text-[13px] text-jf-ink-3">PDF ou DOCX, até 5 MB</span>
          <input
            ref={fileRef}
            id={fileId}
            type="file"
            accept=".pdf,.docx"
            disabled={disabled}
            aria-label="Arquivo do currículo (PDF ou DOCX)"
            className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </label>

        <button
          type="button"
          className={`${BTN_OUTLINE} w-full`}
          aria-expanded={pasteOpen}
          aria-controls={`${textId}-box`}
          onClick={() => setPasteOpen((v) => !v)}
        >
          Colar o texto do currículo ou do LinkedIn
        </button>
        {pasteOpen && (
          <div id={`${textId}-box`} className="flex flex-col gap-3">
            <label className={FIELD_LABEL} htmlFor={textId}>
              Texto do currículo
            </label>
            <textarea
              ref={textRef}
              id={textId}
              rows={6}
              className={FIELD}
              placeholder="Cole aqui..."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <button
              type="button"
              className={BTN_PRIMARY}
              disabled={disabled || text.trim() === ""}
              onClick={() => void run({ kind: "text", text })}
            >
              Analisar com IA
            </button>
          </div>
        )}

        {busy && (
          <div className="flex flex-wrap items-center justify-between gap-2" role="status">
            <p className="text-sm text-jf-ink-2">
              {status === "reading" ? "Lendo o arquivo..." : "Estruturando o currículo com IA..."}
            </p>
            <button type="button" className={BTN_OUTLINE} onClick={() => {
                abortRef.current?.abort();
                abortRef.current = null;
                setStatus("idle");
              }}>
              Cancelar
            </button>
          </div>
        )}
        {failure && (
          <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border border-jf-danger-fg/30 bg-jf-danger-bg px-4 py-3 text-sm text-jf-danger-fg">
            <p>{failure.text}</p>
            {failure.retryable && lastJob && (
              <button type="button" className={BTN_OUTLINE} onClick={() => void run(lastJob)}>
                Tentar de novo
              </button>
            )}
          </div>
        )}
        {!hasProfile && (
          <button type="button" className={`${BTN_OUTLINE} w-full`} onClick={onManual}>
            Preencher manualmente
          </button>
        )}
      </div>

      {lastImport && (
        <div className={`${CARD} flex flex-col gap-1.5 px-5 py-[18px] sm:px-[22px]`}>
          <p className="font-semibold">Última importação</p>
          <p className="text-sm text-jf-ink-2">
            {lastImport.source}
            {lastImport.pages !== null && ` · ${lastImport.pages === 1 ? "1 página" : `${lastImport.pages} páginas`}`}
          </p>
          <p className="text-[13px] text-jf-ink-3">Revise os campos ao lado: a IA pode errar em PDFs com colunas.</p>
        </div>
      )}
    </section>
  );
}
