"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ProviderDef } from "@/lib/client/ai/providers";
import { isLoopbackBaseURL } from "@/lib/client/ai/settings";

export type KeyDraft = { key?: string; baseURL?: string };

type Props = {
  /** Provedor que está recebendo a chave; `null` fecha o diálogo. */
  provider: ProviderDef | null;
  onSave: (draft: KeyDraft) => void;
  onClose: () => void;
};

function validate(provider: ProviderDef, key: string, baseURL: string): string | null {
  if (provider.editableBaseURL) {
    return isLoopbackBaseURL(baseURL.trim()) ? null : "Use um endereço http://127.0.0.1:<porta>/v1 ou http://localhost:<porta>/v1.";
  }
  const k = key.trim();
  if (k === "") return "Cole a chave de API.";
  if (/\s/.test(k)) return "A chave não pode ter espaços. Confira se copiou só a chave.";
  return null;
}

function KeyForm({ provider, onSave, onClose }: { provider: ProviderDef; onSave: Props["onSave"]; onClose: () => void }) {
  const keyId = useId();
  const urlId = useId();
  const errId = useId();
  const [key, setKey] = useState("");
  const [baseURL, setBaseURL] = useState(provider.baseURL);
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const problem = validate(provider, key, baseURL);
    if (problem) {
      setError(problem);
      return;
    }
    onSave(provider.editableBaseURL ? { baseURL: baseURL.trim() } : { key: key.trim() });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {provider.editableBaseURL ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={urlId} className="text-[13px] font-semibold text-jf-ink-2">
            Endereço do servidor local
          </label>
          <Input
            id={urlId}
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errId : undefined}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={keyId} className="text-[13px] font-semibold text-jf-ink-2">
            Chave de API
          </label>
          <div className="flex gap-2">
            <Input
              id={keyId}
              type={reveal ? "text" : "password"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errId : undefined}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={reveal ? "Ocultar chave" : "Mostrar chave"}
              aria-pressed={reveal}
              onClick={() => setReveal((v) => !v)}
            >
              {reveal ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p id={errId} role="alert" className="text-[13px] text-jf-danger-fg">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit">Salvar</Button>
      </DialogFooter>
    </form>
  );
}

/** Colar a chave de API (ou o endereço, na IA local). A chave só sai deste diálogo para o localStorage. */
export function AddKeyDialog({ provider, onSave, onClose }: Props) {
  return (
    <Dialog open={provider !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {provider && (
          <>
            <DialogHeader>
              <DialogTitle>Adicionar chave — {provider.label}</DialogTitle>
              <DialogDescription>
                {provider.editableBaseURL
                  ? "Informe o endereço do servidor que roda no seu computador. Nada sai da sua máquina."
                  : "Crie uma chave só para o Job Find, com limite de gasto. Ela fica apenas neste navegador."}{" "}
                <a href={provider.keyDocsUrl} target="_blank" rel="noopener noreferrer">
                  Como criar a chave (abre em nova aba)
                </a>
              </DialogDescription>
            </DialogHeader>
            <KeyForm provider={provider} onSave={onSave} onClose={onClose} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
