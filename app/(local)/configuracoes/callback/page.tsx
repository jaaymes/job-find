"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AiError } from "@/lib/client/ai/errors";
import { completeOAuth, readPending } from "@/lib/client/ai/oauth";
import { PROVIDERS, type ProviderId } from "@/lib/client/ai/providers";
import { aiSettingsStore } from "@/lib/client/ai/settings";
import { HardLink } from "@/components/ui/hard-link";

/** Mensagem para o usuário. Nunca inclui code, verifier, state ou chave. */
function messageFor(e: unknown, label: string | null): string {
  if (e instanceof AiError) {
    if (e.meta?.reason === "missing_verifier") {
      return "Não encontramos a sessão de conexão. Abra o fluxo de novo na mesma aba, a partir das configurações.";
    }
    if (e.meta?.reason === "state_mismatch") {
      return "O retorno do login não confere com esta sessão. Conecte de novo nas configurações.";
    }
    if (e.code === "invalid_key") {
      return `${label ? `O ${label}` : "O provedor"} recusou o código de autorização. Tente conectar de novo.`;
    }
  }
  return `Não foi possível concluir a conexão com ${label ? `o ${label}` : "o provedor"}. Tente de novo.`;
}

function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  // Fixa code e state na primeira renderização: replaceState os remove da URL e o useSearchParams passaria a vê-los vazios.
  const [code] = useState(() => params.get("code"));
  const [state] = useState(() => params.get("state"));
  // Só para o título; o pending é consumido (e validado) por completeOAuth.
  const [provider] = useState<ProviderId | null>(() => readPending()?.provider ?? null);
  const label = provider ? PROVIDERS[provider].label : null;
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Tira code e state da URL antes de qualquer outra coisa.
    window.history.replaceState(null, "", window.location.pathname);
    if (!code) return;
    void (async () => {
      try {
        const { provider: id, tokens, intent } = await completeOAuth({ code, state, origin: window.location.origin });
        const current = aiSettingsStore.get();
        const prev = current.providers[id];
        const res = aiSettingsStore.set({
          ...current,
          providers: {
            ...current.providers,
            [id]: {
              ...prev,
              key: tokens.key,
              refreshToken: tokens.refreshToken,
              expiresAt: tokens.expiresAt,
              addedAt: new Date().toISOString(),
              source: "oauth",
              ...(intent.freeConsent ? { freeConsent: true } : {}),
            },
          },
        });
        if (!res.ok) {
          setError("Não foi possível salvar neste navegador.");
          return;
        }
        router.replace("/configuracoes");
      } catch (e) {
        setError(messageFor(e, label));
      }
    })();
  }, [code, state, label, router]);

  if (error || !code) {
    return (
      <div role="alert" className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">{label ? `Falha ao conectar o ${label}` : "Falha ao conectar o provedor"}</h1>
        <p>
          {error ??
            `Código de autorização ausente. Conecte ${label ? `o ${label}` : "o provedor"} de novo nas configurações.`}
        </p>
        <HardLink href="/configuracoes" className="underline">
          Voltar às configurações
        </HardLink>
      </div>
    );
  }
  return (
    <p role="status" aria-live="polite">
      {label ? `Conectando ao ${label}…` : "Conectando ao provedor…"}
    </p>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<p role="status">Conectando ao provedor…</p>}>
      <Callback />
    </Suspense>
  );
}
