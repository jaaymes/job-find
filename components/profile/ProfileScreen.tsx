"use client";

import { useState, useSyncExternalStore } from "react";
import { ReturnToJobLink } from "@/components/onboarding/SetupProgress";
import { NoProviderCta } from "@/components/settings/NoProviderCta";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { hasUsableProvider } from "@/lib/client/ai/model";
import { aiSettingsStore } from "@/lib/client/ai/settings";
import { profileStore } from "@/lib/client/profile/store";
import { useStore } from "@/lib/client/storage/store";
import { emptyProfile, type Profile } from "@/lib/shared/schemas/profile";
import { ImportPanel, type ImportMeta } from "./ImportPanel";
import { ProfileEditor } from "./ProfileEditor";
import { CARD } from "@/components/ui/styles";
import { Skeleton } from "@/components/ui/skeleton";

const noop = () => () => {};

export function ProfileScreen() {
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  const settings = useStore(aiSettingsStore);
  const profile = useStore(profileStore);
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState<{ profile: Profile; meta: ImportMeta } | null>(null);
  const [lastImport, setLastImport] = useState<ImportMeta | null>(null);
  const [saveError, setSaveError] = useState(false);
  // "Preencher manualmente": rascunho só em memória até o primeiro "Salvar perfil".
  const [manual, setManual] = useState(false);

  if (!hydrated || !settings) {
    return <Skeleton label="Carregando perfil" className={`${CARD} h-64`} />;
  }

  const canUseAi = hasUsableProvider(settings, "extract");

  /** `replace`: o perfil gravado substitui o que o editor mostra (importação), então o editor é recriado. */
  function persist(p: Profile, replace: boolean, meta?: ImportMeta): boolean {
    const r = profileStore.set(p);
    if (!r.ok) {
      setSaveError(true);
      return false;
    }
    setSaveError(false);
    setManual(false);
    if (replace) setRevision((n) => n + 1);
    if (meta) setLastImport(meta);
    return true;
  }

  function onImported(p: Profile, meta: ImportMeta) {
    if (profile) setPending({ profile: p, meta });
    else persist(p, true, meta);
  }

  return (
    <>
      <div>
        <h1 className="font-display text-[32px] leading-tight font-bold">Seu perfil</h1>
        <p className="mt-1.5 max-w-[720px] text-jf-ink-3">
          É a base para calcular suas chances e gerar currículos. Fica salvo só neste navegador e nunca é enviado aos
          nossos servidores.
        </p>
        <div className="mt-3 empty:hidden">
          <ReturnToJobLink />
        </div>
      </div>
      <NoProviderCta task="extract" />
      {saveError && (
        <p role="alert" className="rounded-lg border border-jf-danger-fg/30 bg-jf-danger-bg px-4 py-3 text-sm text-jf-danger-fg">
          Não foi possível salvar. O armazenamento do navegador está cheio ou bloqueado; libere espaço no navegador apagando dados antigos do Job Find.
        </p>
      )}
      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-[1_1_340px] lg:max-w-[420px]">
          <ImportPanel
            settings={settings}
            canUseAi={canUseAi}
            onImported={onImported}
            onManual={() => {
              setRevision((n) => n + 1);
              setManual(true);
            }}
            hasProfile={profile !== null || manual}
            lastImport={lastImport}
          />
        </div>
        <div className="min-w-0 flex-[999_1_560px]">
          {profile || manual ? (
            <ProfileEditor key={revision} profile={profile ?? emptyProfile()} onSave={(p) => persist(p, false)} />
          ) : (
            <div className={`${CARD} p-6 text-jf-ink-3`}>
              Ainda não há perfil. Importe um currículo ou preencha manualmente para ver as suas chances nas vagas.
            </div>
          )}
        </div>
      </div>

      <Dialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Substituir o perfil atual?</DialogTitle>
            <DialogDescription>
              Você já tem um perfil salvo. Ao substituir, as edições feitas nele são perdidas e os dados do currículo
              importado passam a valer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setPending(null)}>
              Manter o perfil atual
            </Button>
            <Button
              type="button"
              className="min-h-11"
              onClick={() => {
                if (pending) persist(pending.profile, true, pending.meta);
                setPending(null);
              }}
            >
              Substituir perfil
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
