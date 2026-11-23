"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { AiError } from "@/lib/client/ai/errors";
import { type ProviderDef, type ProviderId } from "@/lib/client/ai/providers";
import type { AiSettings } from "@/lib/client/ai/settings";
import { testConnection } from "@/lib/client/ai/test-connection";
import { cn } from "@/lib/utils";
import { LocalAiGuide } from "./LocalAiGuide";

type Entry = AiSettings["providers"][ProviderId];

const DESCRIPTIONS: Record<ProviderId, string> = {
  openrouter: "Centenas de modelos com uma conta. Login seguro, chave com limite de US$ 5.",
  openai: "Modelos GPT com a sua chave da plataforma OpenAI.",
  anthropic: "Modelos Claude. Crie uma chave só para o Job Find, com limite de gasto.",
  google: "Chave do Google AI Studio.",
  deepseek: "API direta da DeepSeek, uma das opções mais baratas.",
  local: "Roda no seu computador, grátis e privado. Exige liberar o acesso do navegador.",
  groq: "Inferência rápida de modelos abertos.",
  mistral: "Modelos da Mistral AI.",
  cerebras: "Inferência rápida de modelos abertos.",
  xai: "Modelos Grok, da xAI.",
  together: "Modelos abertos hospedados pela Together AI.",
  fireworks: "Modelos abertos hospedados pela Fireworks AI.",
  huggingface: "Modelos abertos pelo roteador da Hugging Face.",
  "vercel-gateway": "Um só ponto de acesso para vários provedores, pelo Vercel AI Gateway.",
};

function failureText(e: unknown): string {
  if (e instanceof AiError) {
    switch (e.code) {
      case "invalid_key":
        return "Chave inválida";
      case "no_credit":
        return "Sem créditos nesta conta do provedor.";
      case "rate_limit":
        return "Limite de uso atingido. Tente de novo em instantes.";
      case "local_blocked":
        return "Não foi possível acessar a IA local. Veja o guia: o servidor precisa liberar esta página (CORS).";
      default:
    }
  }
  return "Não foi possível falar com o provedor. Verifique a conexão e tente de novo.";
}

type Test = { state: "idle" } | { state: "loading" } | { state: "ok" } | { state: "error"; text: string };

type Props = {
  def: ProviderDef;
  entry: Entry | undefined;
  connected: boolean;
  onAdd: () => void;
  onConnectPkce: () => void;
  onRemove: () => void;
  onReviewPrivacy: () => void;
  pkceError?: string | null;
};

export function ProviderCard({ def, entry, connected, onAdd, onConnectPkce, onRemove, onReviewPrivacy, pkceError }: Props) {
  const titleId = useId();
  const [test, setTest] = useState<Test>({ state: "idle" });
  const [showGuide, setShowGuide] = useState(false);
  const isLocal = def.id === "local";
  const needsReview = connected && def.privacyNote !== null && entry?.privacyAccepted !== true;

  async function runTest() {
    setTest({ state: "loading" });
    try {
      await testConnection(def, { apiKey: entry?.key, baseURL: entry?.baseURL });
      setTest({ state: "ok" });
    } catch (e) {
      setTest({ state: "error", text: failureText(e) });
    }
  }

  function remove() {
    setTest({ state: "idle" });
    onRemove();
  }

  const last4 = entry?.key ? entry.key.slice(-4) : null;
  const date = entry ? new Date(entry.addedAt).toLocaleDateString("pt-BR") : null;
  const detail = !connected
    ? DESCRIPTIONS[def.id]
    : isLocal
      ? `Servidor em ${entry?.baseURL ?? def.baseURL}.`
      : entry?.source === "pkce"
        ? `Conectado pelo login do OpenRouter em ${date}. Chave terminada em ${last4}.`
        : `Chave colada em ${date}. Chave terminada em ${last4}.`;

  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col gap-2.5 rounded-[14px] border border-jf-line bg-jf-surface p-[18px]"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id={titleId} className="text-base font-semibold">
          {def.label}
        </h3>
        <span className="flex shrink-0 gap-1.5">
          {isLocal && <span className="rounded-full bg-jf-new-bg px-2.5 py-1 text-xs font-semibold text-jf-new-fg">Experimental</span>}
          <span
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-semibold",
              connected ? "bg-jf-media-bg text-jf-media-fg" : "bg-jf-baixa-bg text-jf-baixa-fg",
            )}
          >
            {connected ? "Conectado" : "Não conectado"}
          </span>
        </span>
      </div>
      <p className="min-h-9 text-[13px] text-jf-ink-3">{detail}</p>
      {def.privacyNote && (
        <p className="rounded-lg bg-jf-new-bg px-2.5 py-2 text-[13px] text-[#5a3400]">{def.privacyNote}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {connected ? (
          <>
            <Button className="h-10 bg-jf-ink px-3.5 text-sm font-semibold text-white hover:bg-jf-ink-2" onClick={runTest} disabled={test.state === "loading"}>
              Testar conexão
            </Button>
            <Button variant="outline" className="h-10 border-jf-line-strong px-3 text-sm" onClick={remove}>
              {def.auth === "paste" ? "Remover chave" : "Desconectar"}
            </Button>
            {needsReview && (
              <Button variant="outline" className="h-10 border-jf-line-strong px-3 text-sm" onClick={onReviewPrivacy}>
                Revisar aviso de privacidade
              </Button>
            )}
          </>
        ) : (
          <>
            <Button
              className="h-10 bg-jf-brand px-3.5 text-sm font-semibold text-white hover:bg-jf-brand-dark"
              onClick={def.auth === "pkce" ? onConnectPkce : onAdd}
            >
              {def.auth === "pkce" ? "Conectar" : isLocal ? "Configurar" : "Adicionar chave"}
            </Button>
            {!isLocal && (
              <a
                href={def.keyDocsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-10 items-center rounded-lg border border-jf-line-strong px-3 text-sm text-jf-ink no-underline hover:bg-jf-chip"
              >
                Como criar a chave
                <span className="sr-only"> (abre em nova aba)</span>
              </a>
            )}
          </>
        )}
        {isLocal && (
          <Button
            variant="outline"
            className="h-10 border-jf-line-strong px-3 text-sm"
            aria-expanded={showGuide}
            onClick={() => setShowGuide((v) => !v)}
          >
            Ver guia
          </Button>
        )}
      </div>
      {test.state !== "idle" && (
        <p
          role="status"
          aria-live="polite"
          className={cn("text-[13px] font-semibold", test.state === "error" ? "text-jf-danger-fg" : "text-jf-alta")}
        >
          {test.state === "loading" ? "Testando…" : test.state === "ok" ? "Conectado" : test.text}
        </p>
      )}
      {pkceError && (
        <p role="alert" className="text-[13px] text-jf-danger-fg">
          {pkceError}
        </p>
      )}
      {isLocal && showGuide && <LocalAiGuide />}
    </article>
  );
}
