"use client";

import { useState } from "react";
import { FREE_MODELS_NOTE, PROVIDER_IDS, PROVIDERS, type AiTask, type ProviderId } from "@/lib/client/ai/providers";
import { startOAuth, type OAuthIntent } from "@/lib/client/ai/oauth";
import { isConnected } from "@/lib/client/ai/model";
import { aiSettingsStore, type AiSettings } from "@/lib/client/ai/settings";
import { useStore } from "@/lib/client/storage/store";
import { BackupSection } from "./BackupSection";
import { AddKeyDialog, type KeyDraft } from "./AddKeyDialog";
import { PrivacyConsentDialog } from "./PrivacyConsentDialog";
import { ProviderCard } from "./ProviderCard";
import { TaskModelRow } from "./TaskModelRow";

const TASKS: AiTask[] = ["extract", "analyze", "cv"];
const MUST = PROVIDER_IDS.filter((id) => PROVIDERS[id].tier === "must");
const SHOULD = PROVIDER_IDS.filter((id) => PROVIDERS[id].tier === "should");
const SAVE_ERROR = "Não foi possível salvar neste navegador.";
const SECTION = "flex flex-col gap-3 rounded-2xl border border-jf-line bg-jf-surface p-6";

/**
 * O aviso de privacidade antecede a chave (`then: "key"`), o login do OpenRouter (`then: "oauth"`, aviso dos modelos
 * gratuitos, que são o padrão) ou revisa um provedor já conectado (`then: "accept"`).
 */
type Privacy = { id: ProviderId; then: "key" | "accept" | "oauth" };
type OAuthError = { id: ProviderId; text: string };
type KeyTarget = { id: ProviderId; privacyAccepted: boolean };

export function AiSettingsScreen() {
  const settings = useStore(aiSettingsStore);
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [keyTarget, setKeyTarget] = useState<KeyTarget | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [oauthError, setOAuthError] = useState<OAuthError | null>(null);

  if (!settings) {
    return <div aria-busy="true" aria-label="Carregando configurações" className="h-96 animate-pulse rounded-2xl bg-jf-chip" />;
  }

  function update(fn: (s: AiSettings) => AiSettings): boolean {
    const res = aiSettingsStore.set(fn(aiSettingsStore.get()));
    setSaveError(res.ok ? null : SAVE_ERROR);
    return res.ok;
  }

  function startAdd(id: ProviderId) {
    const accepted = aiSettingsStore.get().providers[id]?.privacyAccepted === true;
    if (PROVIDERS[id].privacyNote && !accepted) setPrivacy({ id, then: "key" });
    else setKeyTarget({ id, privacyAccepted: accepted });
  }

  function saveKey(draft: KeyDraft) {
    if (!keyTarget) return;
    const { id, privacyAccepted } = keyTarget;
    const ok = update((s) => ({
      ...s,
      providers: {
        ...s.providers,
        [id]: {
          ...draft,
          addedAt: new Date().toISOString(),
          source: "paste" as const,
          ...(privacyAccepted ? { privacyAccepted: true } : {}),
        },
      },
    }));
    if (ok) setKeyTarget(null);
  }

  function remove(id: ProviderId) {
    update((s) => {
      const rest = { ...s.providers };
      delete rest[id];
      const tasks = { ...s.tasks };
      for (const t of TASKS) if (tasks[t]?.provider === id) tasks[t] = null;
      return { ...s, providers: rest, tasks };
    });
  }

  function confirmPrivacy() {
    if (!privacy) return;
    const { id, then } = privacy;
    setPrivacy(null);
    if (then === "oauth") {
      void beginOAuth(id, { freeConsent: true });
      return;
    }
    if (then === "key") {
      setKeyTarget({ id, privacyAccepted: true });
      return;
    }
    update((s) => {
      const cfg = s.providers[id];
      if (!cfg) return s;
      const ack = id === "openrouter" ? { freeConsent: true } : { privacyAccepted: true };
      return { ...s, providers: { ...s.providers, [id]: { ...cfg, ...ack } } };
    });
  }

  /** OpenRouter abre antes o aviso dos modelos gratuitos; os demais vão direto para o login do provedor. */
  function connectOAuth(id: ProviderId) {
    setOAuthError(null);
    if (id === "openrouter") setPrivacy({ id, then: "oauth" });
    else void beginOAuth(id);
  }

  async function beginOAuth(id: ProviderId, intent?: OAuthIntent) {
    try {
      window.location.assign(await startOAuth(id, window.location.origin, intent));
    } catch {
      setOAuthError({
        id,
        text: "Não foi possível iniciar a conexão. Verifique se o navegador permite guardar dados da sessão.",
      });
    }
  }

  const card = (id: ProviderId) => (
    <ProviderCard
      key={id}
      def={PROVIDERS[id]}
      entry={settings.providers[id]}
      connected={isConnected(settings, id)}
      onAdd={() => startAdd(id)}
      onConnectOAuth={() => connectOAuth(id)}
      onRemove={() => remove(id)}
      onReviewPrivacy={() => setPrivacy({ id, then: "accept" })}
      oauthError={oauthError?.id === id ? oauthError.text : null}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-[32px] font-bold">Configurações de IA</h1>
        <p className="mt-1.5 max-w-[760px] text-jf-ink-3">
          Use a IA que preferir com a sua própria chave. As chaves ficam só neste navegador, e as chamadas vão direto do
          seu navegador para o provedor, sem passar pelos nossos servidores.
        </p>
      </div>

      {saveError && (
        <p role="alert" className="rounded-lg bg-jf-danger-bg px-3 py-2 text-sm text-jf-danger-fg">
          {saveError}
        </p>
      )}

      <section aria-labelledby="prov-t" className="flex flex-col gap-3.5">
        <h2 id="prov-t" className="text-xl font-semibold">
          Provedores
        </h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3.5">{MUST.map(card)}</div>
        <details className="rounded-[14px] border border-jf-line bg-jf-surface px-[18px] py-4">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Mais provedores ({SHOULD.length})</summary>
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3.5">
            {SHOULD.map(card)}
          </div>
        </details>
      </section>

      <section aria-labelledby="task-t" className={`${SECTION} gap-4`}>
        <div>
          <h2 id="task-t" className="text-xl font-semibold">
            Modelo para cada tarefa
          </h2>
          <p className="mt-1.5 text-sm text-jf-ink-3">
            Escolha entre os provedores conectados. Tarefas de extração podem usar um modelo mais barato. Em
            &ldquo;Automático&rdquo;, o app usa o primeiro provedor conectado com o modelo recomendado.
          </p>
        </div>
        {TASKS.map((task) => (
          <TaskModelRow
            key={task}
            task={task}
            settings={settings}
            onChange={(choice) => update((s) => ({ ...s, tasks: { ...s.tasks, [task]: choice } }))}
          />
        ))}
      </section>

      <div className="flex flex-wrap gap-6">
        <section aria-labelledby="priv-t" className={`${SECTION} flex-[1_1_420px]`}>
          <h2 id="priv-t" className="text-lg font-semibold">
            Privacidade
          </h2>
          <label className="flex min-h-11 items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              className="size-5 shrink-0"
              checked={settings.dataCollectionDeny}
              onChange={(e) => update((s) => ({ ...s, dataCollectionDeny: e.target.checked }))}
            />
            <span>
              Pedir ao OpenRouter que use só provedores que não guardam meus dados (não vale para os modelos
              gratuitos)
            </span>
          </label>
          <p className="text-sm text-jf-ink-2">E-mail, telefone e endereço nunca são enviados à IA.</p>
          <p className="text-[13px] text-jf-ink-3">Cada provedor tem a própria política de dados.</p>
        </section>

        <BackupSection />
      </div>

      <PrivacyConsentDialog
        provider={privacy ? PROVIDERS[privacy.id] : null}
        title={privacy?.id === "openrouter" ? "Aviso dos modelos gratuitos — OpenRouter" : undefined}
        note={privacy?.id === "openrouter" ? FREE_MODELS_NOTE : undefined}
        onConfirm={confirmPrivacy}
        onCancel={() => setPrivacy(null)}
      />
      <AddKeyDialog provider={keyTarget ? PROVIDERS[keyTarget.id] : null} onSave={saveKey} onClose={() => setKeyTarget(null)} />
    </div>
  );
}
