"use client";

import { ChevronRight, Star } from "lucide-react";
import { useId, useState } from "react";
import { aiFailure } from "@/components/ai/messages";
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
    return aiFailure(e, {
      noProvider: "Conecte uma IA para usá-la.",
      truncated: "A resposta da IA foi cortada.",
      fallback: "Não foi possível falar com o provedor. Verifique a conexão e tente de novo.",
    });
  }
  return "Não foi possível falar com o provedor. Verifique a conexão e tente de novo.";
}

type Test = { state: "idle" } | { state: "loading" } | { state: "ok" } | { state: "error"; text: string };

type Props = {
  def: ProviderDef;
  entry: Entry | undefined;
  connected: boolean;
  onAdd: () => void;
  onConnectOAuth: () => void;
  onRemove: () => void;
  onReviewPrivacy: () => void;
  oauthError?: string | null;
  /** `"compact"`: uma linha para provedor conectado (nome, forma de conexão e ações), sem a descrição longa. */
  variant?: "card" | "compact";
};

export function ProviderCard({
  def,
  entry,
  connected,
  onAdd,
  onConnectOAuth,
  onRemove,
  onReviewPrivacy,
  oauthError,
  variant = "card",
}: Props) {
  const titleId = useId();
  const [test, setTest] = useState<Test>({ state: "idle" });
  const [showGuide, setShowGuide] = useState(false);
  const isLocal = def.id === "local";
  // OpenRouter: o padrão são os modelos gratuitos, que pedem o próprio aviso (`freeConsent`).
  const isOpenRouter = def.id === "openrouter";
  const needsReview =
    connected && (isOpenRouter ? entry?.freeConsent !== true : def.privacyNote !== null && entry?.privacyAccepted !== true);

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
      : entry?.source === "oauth"
        ? `Conectado pelo login do ${def.label} em ${date}. Chave terminada em ${last4}.`
        : `Chave colada em ${date}. Chave terminada em ${last4}.`;

  const removeLabel = def.auth.kind === "paste" ? "Remover chave" : "Desconectar";
  const reviewLabel = isOpenRouter ? "Revisar aviso dos modelos gratuitos" : "Revisar aviso de privacidade";
  const testStatus = test.state !== "idle" && (
    <p
      role="status"
      aria-live="polite"
      className={cn("text-[13px] font-semibold", test.state === "error" ? "text-jf-danger-fg" : "text-jf-alta")}
    >
      {test.state === "loading" ? "Testando…" : test.state === "ok" ? "Conectado" : test.text}
    </p>
  );
  const oauthAlert = oauthError && (
    <p role="alert" className="text-[13px] text-jf-danger-fg">
      {oauthError}
    </p>
  );

  const guideButton = (
    <Button
      variant="outline"
      className="min-h-11 border-jf-line-strong px-3 text-sm"
      aria-expanded={showGuide}
      onClick={() => setShowGuide((v) => !v)}
    >
      Ver guia
    </Button>
  );

  if (variant === "compact") {
    // Na linha compacta o guia só aparece quando o teste falha: é quando ele ajuda (CORS, servidor desligado).
    // Depois de aberto, fica até ser fechado (não some enquanto um novo teste roda).
    const showGuideButton = isLocal && (test.state === "error" || showGuide);
    const how = isLocal
      ? `Servidor em ${entry?.baseURL ?? def.baseURL}`
      : entry?.source === "oauth"
        ? "Conectado com OAuth"
        : "Chave colada";
    return (
      <article aria-labelledby={titleId} className="flex flex-col gap-2 px-[18px] py-3.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <div className="min-w-0 flex-[1_1_220px]">
            <h3 id={titleId} className="flex items-center gap-2 text-base font-semibold">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-jf-alta" />
              {def.label}
            </h3>
            <p className="mt-0.5 pl-4 text-[13px] text-jf-ink-3">
              <span>{how}</span>
              {last4 && !isLocal && <span className="tabular-nums"> · termina em {last4}</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {needsReview && (
              <Button
                variant="outline"
                className="min-h-11 border-jf-line-strong px-3 text-sm text-jf-warn-fg-strong"
                onClick={onReviewPrivacy}
              >
                {reviewLabel}
              </Button>
            )}
            <Button
              variant="outline"
              className="min-h-11 border-jf-line-strong px-3 text-sm"
              onClick={runTest}
              disabled={test.state === "loading"}
            >
              Testar conexão
            </Button>
            <Button variant="ghost" className="min-h-11 px-3 text-sm text-jf-ink-2" onClick={remove}>
              {removeLabel}
            </Button>
            {showGuideButton && guideButton}
          </div>
        </div>
        {testStatus}
        {oauthAlert}
        {showGuideButton && showGuide && <LocalAiGuide />}
      </article>
    );
  }

  return (
    <article
      aria-labelledby={titleId}
      className="flex flex-col gap-2.5 rounded-[14px] border border-jf-line bg-jf-surface p-[18px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <h3 id={titleId} className="text-base font-semibold">
          {def.label}
        </h3>
        <span className="flex flex-wrap gap-1.5">
          {isOpenRouter && (
            <span className="inline-flex items-center gap-1 rounded-full bg-jf-brand-soft px-2.5 py-1 text-xs font-semibold text-jf-brand-dark">
              <Star aria-hidden="true" className="size-3 fill-current" />
              Recomendado
            </span>
          )}
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
        <p className="rounded-lg bg-jf-new-bg px-2.5 py-2 text-[13px] text-jf-warn-fg-strong">{def.privacyNote}</p>
      )}
      <div className="flex flex-wrap gap-2">
        {connected ? (
          <>
            <Button className="min-h-11 bg-jf-ink px-3.5 text-sm font-semibold text-jf-surface hover:bg-jf-ink-2" onClick={runTest} disabled={test.state === "loading"}>
              Testar conexão
            </Button>
            <Button variant="outline" className="min-h-11 border-jf-line-strong px-3 text-sm" onClick={remove}>
              {removeLabel}
            </Button>
            {needsReview && (
              <Button variant="outline" className="min-h-11 border-jf-line-strong px-3 text-sm" onClick={onReviewPrivacy}>
                {reviewLabel}
              </Button>
            )}
          </>
        ) : (
          <>
            {/* Só o OpenRouter (recomendado) tem o botão primário; os demais usam contorno. */}
            <Button
              variant={isOpenRouter ? "primary" : "outline"}
              className={
                isOpenRouter
                  ? "h-auto rounded-lg px-3.5"
                  : "min-h-11 border-jf-line-strong px-3 text-sm"
              }
              onClick={def.auth.kind === "oauth" ? onConnectOAuth : onAdd}
            >
              {def.auth.kind === "oauth"
                ? `Conectar com ${def.label}`
                : def.auth.kind === "none"
                  ? "Configurar"
                  : "Adicionar chave"}
            </Button>
            {!isLocal && (
              <a
                href={def.keyDocsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center rounded-lg border border-jf-line-strong px-3 text-sm text-jf-ink no-underline hover:bg-jf-chip"
              >
                Como criar a chave
                <span className="sr-only"> (abre em nova aba)</span>
              </a>
            )}
          </>
        )}
        {isLocal && guideButton}
      </div>
      {testStatus}
      {oauthAlert}
      {isLocal && showGuide && <LocalAiGuide />}
    </article>
  );
}

/** Linha de 56px de um provedor ainda não conectado: nome, estado e "›". Abre o sheet com a ação (`onOpen`). */
export function ProviderRow({ def, onOpen }: { def: ProviderDef; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-14 w-full items-center gap-3 px-[18px] py-2 text-left outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-jf-brand"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-base font-semibold text-jf-ink">{def.label}</span>
        <span className="text-[13px] text-jf-ink-3">
          Não conectado{def.id === "local" ? " · Experimental" : ""}
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-jf-ink-3" />
    </button>
  );
}
