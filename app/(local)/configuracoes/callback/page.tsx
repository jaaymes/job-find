"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { AiError } from "@/lib/client/ai/errors";
import { completeOpenRouterAuth, takeFreeConsentIntent } from "@/lib/client/ai/pkce";
import { aiSettingsStore } from "@/lib/client/ai/settings";
import { HardLink } from "@/components/ui/hard-link";

function messageFor(e: unknown): string {
  if (e instanceof AiError) {
    if (e.meta?.reason === "missing_verifier") {
      return "Não encontramos a sessão de conexão. Abra o fluxo de novo na mesma aba, a partir das configurações.";
    }
    if (e.code === "invalid_key") return "O OpenRouter recusou o código de autorização. Tente conectar de novo.";
  }
  return "Não foi possível concluir a conexão com o OpenRouter. Tente de novo.";
}

function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  // Fixa o code na primeira renderização: replaceState o remove da URL e o useSearchParams passaria a vê-lo vazio.
  const [code] = useState(() => params.get("code"));
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Tira o code da URL antes de qualquer outra coisa.
    window.history.replaceState(null, "", window.location.pathname);
    // Lido (e apagado) antes da troca, para não sobrar no sessionStorage em caso de erro.
    const freeConsent = takeFreeConsentIntent();
    if (!code) return;
    void (async () => {
      try {
        const key = await completeOpenRouterAuth(code);
        const current = aiSettingsStore.get();
        const prev = current.providers.openrouter;
        const res = aiSettingsStore.set({
          ...current,
          providers: {
            ...current.providers,
            openrouter: {
              ...prev,
              key,
              addedAt: new Date().toISOString(),
              source: "pkce",
              ...(freeConsent ? { freeConsent: true } : {}),
            },
          },
        });
        if (!res.ok) {
          setError("Não foi possível salvar neste navegador.");
          return;
        }
        router.replace("/configuracoes");
      } catch (e) {
        setError(messageFor(e));
      }
    })();
  }, [code, router]);

  if (error || !code) {
    return (
      <div role="alert" className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">Falha ao conectar o OpenRouter</h1>
        <p>{error ?? "Código de autorização ausente. Conecte o OpenRouter de novo nas configurações."}</p>
        <HardLink href="/configuracoes" className="underline">
          Voltar às configurações
        </HardLink>
      </div>
    );
  }
  return (
    <p role="status" aria-live="polite">
      Conectando ao OpenRouter…
    </p>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<p role="status">Conectando ao OpenRouter…</p>}>
      <Callback />
    </Suspense>
  );
}
