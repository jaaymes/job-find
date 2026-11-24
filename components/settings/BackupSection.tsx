"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PROVIDERS, type ProviderId } from "@/lib/client/ai/providers";
import {
  applyBackup,
  backupFilename,
  exportBackup,
  parseBackup,
  type BackupKey,
  type ParseResult,
} from "@/lib/client/storage/backup";
import { storageUsageBytes } from "@/lib/client/storage/store";

type Parsed = Extract<ParseResult, { ok: true }>;

const KEY_LABELS: Record<BackupKey, string> = {
  "jobfind:v1:ai": "Configurações de IA",
  "jobfind:v1:profile": "Perfil",
  "jobfind:v1:jobState": "Favoritos, ocultas e status das vagas",
  "jobfind:v1:aiAnalysis": "Análises de aderência",
  "jobfind:v1:generatedDocs": "CVs e cartas gerados",
  "jobfind:v1:savedFilters": "Busca padrão da home",
  "jobfind:v1:lastVisit": "Data da última visita (selo \"Nova\")",
};

const REASONS = {
  too_large: "O arquivo tem mais de 5 MB. Escolha um backup gerado pelo Job Find.",
  invalid: "Este arquivo não é um backup válido do Job Find.",
} as const;

const SECTION = "flex flex-col gap-3 rounded-2xl border border-jf-line bg-jf-surface p-6";
const BTN = "min-h-11 rounded-[10px] border border-jf-line-strong bg-jf-surface px-4 font-semibold";

/** Exportar e importar o backup local (RF-20). Só roda no cliente depois da hidratação. */
export function BackupSection() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [includeKeys, setIncludeKeys] = useState(false);
  const [pending, setPending] = useState<Parsed | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const usedMb = (storageUsageBytes() / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 });

  function doExport() {
    const url = URL.createObjectURL(exportBackup({ includeKeys }));
    const link = document.createElement("a");
    link.href = url;
    link.download = backupFilename();
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage({ kind: "ok", text: `Backup exportado (${backupFilename()}).` });
  }

  async function onPick(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    const result = await parseBackup(file);
    if (fileInput.current) fileInput.current.value = "";
    if (!result.ok) {
      setMessage({ kind: "error", text: REASONS[result.reason] });
      return;
    }
    setPending(result);
  }

  function confirm(acceptKeys: boolean) {
    if (!pending) return;
    const failed = applyBackup(pending.backup, { acceptKeys });
    setPending(null);
    setMessage(
      failed.length === 0
        ? { kind: "ok", text: "Backup importado." }
        : { kind: "error", text: "Parte do backup não pôde ser gravada neste navegador (sem espaço ou armazenamento indisponível) e não foi importada." },
    );
  }

  const hints = pending ? (Object.entries(pending.keyHints) as [ProviderId, string][]) : [];

  return (
    <section aria-labelledby="bk-t" className={`${SECTION} flex-[1_1_420px]`}>
      <h2 id="bk-t" className="text-lg font-semibold">
        Seus dados neste navegador
      </h2>
      <p className="text-sm text-jf-ink-2">
        Perfil, favoritos, status e CVs ocupam {usedMb} MB de 5 MB. Faça backup: limpar o navegador apaga tudo.
      </p>
      <p className="text-sm text-jf-ink-2">
        Atenção: o arquivo de backup contém dados pessoais (perfil, contatos, CVs). Guarde-o em local seguro e não o
        compartilhe.
      </p>
      <label className="flex min-h-11 items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          className="size-5 shrink-0"
          checked={includeKeys}
          onChange={(e) => setIncludeKeys(e.target.checked)}
        />
        Incluir chaves de IA no arquivo de backup
      </label>
      {includeKeys && (
        <p className="text-[13px] text-jf-danger-fg">
          Quem tiver o arquivo poderá usar as suas chaves de IA e gastar o seu saldo.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BTN} onClick={doExport}>
          Exportar dados
        </button>
        <button type="button" className={BTN} onClick={() => fileInput.current?.click()}>
          Importar backup
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Selecionar arquivo JSON"
          onChange={(e) => void onPick(e.target.files?.[0])}
        />
      </div>
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-lg px-3 py-2 text-sm ${message.kind === "error" ? "bg-jf-danger-bg text-jf-danger-fg" : "text-jf-ink-2"}`}
        >
          {message.text}
        </p>
      )}

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          {pending && (
            <>
              <DialogHeader>
                <DialogTitle>Importar backup</DialogTitle>
                <DialogDescription>Os dados abaixo serão substituídos pelos do arquivo, sem mesclar.</DialogDescription>
              </DialogHeader>
              <ul className="list-disc pl-5 text-sm">
                {pending.keys.map((k) => (
                  <li key={k}>{KEY_LABELS[k]}</li>
                ))}
              </ul>
              {pending.keys.includes("jobfind:v1:ai") && (
                <p className="text-[13px] text-jf-ink-3">
                  Sem importar as chaves, as configurações de IA vêm do arquivo, mas as chaves de API continuam as deste
                  navegador (nenhuma chave nova é adicionada) e provedores que existem só aqui são mantidos. Os avisos de
                  privacidade dos provedores nunca vêm do arquivo: os que você ainda não aceitou aqui serão pedidos de
                  novo.
                </p>
              )}
              {pending.skipped.length > 0 && (
                <p className="text-[13px] text-jf-ink-3">
                  {pending.skipped.length} item(ns) do arquivo são inválidos ou não suportados e serão ignorados.
                </p>
              )}
              {pending.hasKeys && (
                <div className="flex flex-col gap-1.5 text-sm">
                  <p className="font-semibold">O arquivo traz chaves de IA:</p>
                  <ul className="list-disc pl-5">
                    {hints.map(([id, hint]) => (
                      <li key={id}>
                        {PROVIDERS[id].label}: chave terminada em {hint}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[13px] text-jf-ink-3">
                    Importe as chaves só se confiar neste arquivo. Com as chaves, as suas chaves e provedores atuais são
                    substituídos pelos do arquivo. Sem elas, as suas chaves atuais ficam como estão.
                  </p>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" className="min-h-11" onClick={() => setPending(null)}>
                  Cancelar
                </Button>
                {pending.hasKeys ? (
                  <>
                    <Button variant="outline" className="min-h-11" onClick={() => confirm(false)}>
                      Importar sem as chaves
                    </Button>
                    <Button className="min-h-11" onClick={() => confirm(true)}>
                      Importar com as chaves
                    </Button>
                  </>
                ) : (
                  <Button className="min-h-11" onClick={() => confirm(false)}>
                    Importar
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
