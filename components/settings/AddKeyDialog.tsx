"use client";

import type { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AiError } from "@/lib/client/ai/errors";
import { checkKey } from "@/lib/client/ai/key-hint";
import type { ProviderDef } from "@/lib/client/ai/providers";
import { isLoopbackBaseURL } from "@/lib/client/ai/settings";
import { testConnection } from "@/lib/client/ai/test-connection";

export type KeyDraft = { key?: string; baseURL?: string };
export type DialogFinalFocus = DialogPrimitive.Popup.Props["finalFocus"];

type Props = {
  /** Provedor que está recebendo a chave; `null` fecha o diálogo. */
  provider: ProviderDef | null;
  /** Recebe a chave já testada (ou que não deu para testar agora); a recusada nunca chega aqui. */
  onSave: (draft: KeyDraft) => void;
  onClose: () => void;
  /** Para onde vai o foco ao fechar (repassado ao `DialogContent`); sem ele, volta ao elemento que abriu o diálogo. */
  finalFocus?: DialogFinalFocus;
};

const REJECTED = "O provedor recusou essa chave.";
const UNTESTED = "Chave salva, mas não deu para testar agora.";
const NO_CREDIT = "Chave salva, mas a conta está sem crédito. Recarregue no site do provedor.";

function validate(provider: ProviderDef, key: string, baseURL: string): string | null {
  if (provider.editableBaseURL) {
    return isLoopbackBaseURL(baseURL.trim()) ? null : "Use um endereço http://127.0.0.1:<porta>/v1 ou http://localhost:<porta>/v1.";
  }
  const k = key.trim();
  if (k === "") return "Cole a chave de API.";
  if (/\s/.test(k)) return "A chave não pode ter espaços. Confira se copiou só a chave.";
  return null;
}

/** Só o código do erro decide o que fazer; a chave nunca vai para a mensagem. */
type Outcome = { save: false } | { save: true; notice: string | null };

async function tryKey(provider: ProviderDef, apiKey: string): Promise<Outcome> {
  try {
    await testConnection(provider, { apiKey });
    return { save: true, notice: null };
  } catch (e) {
    const code = e instanceof AiError ? e.code : "unavailable";
    if (code === "invalid_key") return { save: false };
    if (code === "no_credit" || code === "budget") return { save: true, notice: NO_CREDIT };
    return { save: true, notice: UNTESTED };
  }
}

function KeyForm({ provider, onSave, onClose }: { provider: ProviderDef; onSave: Props["onSave"]; onClose: () => void }) {
  const keyId = useId();
  const urlId = useId();
  const errId = useId();
  const hintId = useId();
  const keyRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  // Trava síncrona: dois cliques no mesmo tick veem o mesmo estado, mas o ref já mudou.
  const busy = useRef(false);
  const [key, setKey] = useState("");
  const [baseURL, setBaseURL] = useState(provider.baseURL);
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const hint = provider.editableBaseURL ? null : checkKey(provider.id, key).warning;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    const problem = validate(provider, key, baseURL);
    if (problem) {
      setError(problem);
      return;
    }
    if (provider.editableBaseURL) {
      onSave({ baseURL: baseURL.trim() });
      return;
    }
    const apiKey = key.trim();
    setError(null);
    busy.current = true;
    setTesting(true);
    const outcome = await tryKey(provider, apiKey);
    busy.current = false;
    // Diálogo fechado durante o teste: descarta o resultado.
    if (!alive.current) return;
    setTesting(false);
    if (!outcome.save) {
      setError(REJECTED);
      keyRef.current?.focus();
      return;
    }
    onSave({ key: apiKey });
    if (outcome.notice) toast(outcome.notice);
  }

  const describedBy = [error ? errId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {provider.editableBaseURL ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={urlId} className="text-[13px] font-semibold text-jf-ink-2">
            Endereço do servidor local
          </label>
          <Input
            id={urlId}
            className="min-h-11"
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
              ref={keyRef}
              id={keyId}
              className="min-h-11"
              type={reveal ? "text" : "password"}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
                if (error) setError(null);
              }}
              placeholder={provider.keyHint ? `Começa com ${provider.keyHint.example}` : undefined}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
            />
            <Button
              type="button"
              variant="outline"
              size="icon" className="size-11 md:size-11"
              aria-label={reveal ? "Ocultar chave" : "Mostrar chave"}
              aria-pressed={reveal}
              onClick={() => setReveal((v) => !v)}
            >
              {reveal ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </Button>
          </div>
          {/* Região sempre montada: o leitor de tela anuncia o aviso quando ele aparece. */}
          <p id={hintId} aria-live="polite" className="min-h-0 text-[13px] text-jf-ink-2 empty:hidden">
            {hint}
          </p>
        </div>
      )}
      {error && (
        <p id={errId} role="alert" className="text-[13px] text-jf-danger-fg">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" className="min-h-11" disabled={testing} aria-busy={testing || undefined}>
          {provider.editableBaseURL ? "Salvar" : testing ? "Testando…" : "Testar e salvar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Colar a chave de API (ou o endereço, na IA local). A chave só sai deste diálogo para o teste e o localStorage. */
export function AddKeyDialog({ provider, onSave, onClose, finalFocus }: Props) {
  return (
    <Dialog open={provider !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent finalFocus={finalFocus}>
        {provider && (
          <>
            <DialogHeader className="pr-10">
              <DialogTitle>Adicionar chave — {provider.label}</DialogTitle>
              <DialogDescription render={<div />}>
                <p>
                  {provider.editableBaseURL
                    ? "Informe o endereço do servidor que roda no seu computador. Nada sai da sua máquina."
                    : "Crie uma chave só para o Job Find, com limite de gasto. Ela fica apenas neste navegador."}
                </p>
                {provider.keySteps && provider.keySteps.length > 0 && (
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    {provider.keySteps.slice(0, 3).map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                )}
                <p className="mt-2">
                  <a
                    href={provider.keyDocsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-jf-brand underline underline-offset-3 hover:text-jf-brand-dark focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jf-brand"
                  >
                    {provider.editableBaseURL ? "Como configurar (abre em nova aba)" : "Criar a chave no site do provedor (abre em nova aba)"}
                  </a>
                </p>
              </DialogDescription>
            </DialogHeader>
            <KeyForm provider={provider} onSave={onSave} onClose={onClose} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
