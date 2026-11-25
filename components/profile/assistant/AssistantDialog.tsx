"use client";

import { NoProviderCta } from "@/components/settings/NoProviderCta";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { hasUsableProvider } from "@/lib/client/ai/model";
import type { AssistTarget, Draft } from "@/lib/client/ai/prompts/profile.assist.v1";
import { aiSettingsStore, type AiSettings } from "@/lib/client/ai/settings";
import { useStore } from "@/lib/client/storage/store";
import type { Profile } from "@/lib/shared/schemas/profile";
import { isDraftEmpty, targetName } from "./DraftEditor";
import { InterviewFlow } from "./InterviewFlow";
import { RewriteFlow } from "./RewriteFlow";
import { useAssistRun } from "./useAssistRun";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  profile: Profile;
  target: AssistTarget;
  current: Draft;
  onInsert: (d: Draft) => void;
};

/** Conteúdo montado só com o painel aberto: fechar desmonta, aborta a geração e descarta as respostas. */
function Body({ profile, target, current, onInsert, settings }: Omit<Props, "open" | "onOpenChange"> & { settings: AiSettings }) {
  const gen = useAssistRun();
  return (
    <>
      {/* Texto parcial do streaming, lido pelo leitor de tela sem roubar o foco. */}
      <div aria-live="polite" className={gen.busy && gen.partial ? "whitespace-pre-wrap rounded-lg bg-jf-chip p-3 text-sm text-jf-ink-2" : "sr-only"}>
        {gen.busy ? gen.partial : ""}
      </div>
      {isDraftEmpty(target, current) ? (
        <InterviewFlow profile={profile} target={target} settings={settings} gen={gen} onInsert={onInsert} />
      ) : (
        <RewriteFlow profile={profile} target={target} settings={settings} current={current} gen={gen} onInsert={onInsert} />
      )}
    </>
  );
}

/** Assistente de IA do perfil (D-06): entrevista com o campo vazio, reescrita com o campo preenchido. */
export function AssistantDialog({ open, onOpenChange, profile, target, current, onInsert }: Props) {
  const settings = useStore(aiSettingsStore);
  const empty = isDraftEmpty(target, current);
  const title = empty ? "Escrever com IA" : "Melhorar com IA";
  const usable = settings !== null && hasUsableProvider(settings, "cv");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobile="sheet" className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{targetName(target)} do perfil. Nada é salvo até você usar “Salvar perfil”.</DialogDescription>
        </DialogHeader>
        {settings && !usable && (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-semibold text-jf-ink">Conecte uma IA para usar o assistente</p>
            <NoProviderCta task="cv" />
          </div>
        )}
        {settings && usable && (
          <Body
            profile={profile}
            target={target}
            current={current}
            settings={settings}
            onInsert={(d) => {
              onInsert(d);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
