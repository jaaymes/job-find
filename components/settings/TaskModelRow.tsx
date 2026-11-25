"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { isConnected } from "@/lib/client/ai/model";
import { isFreeModel, PROVIDER_IDS, PROVIDERS, type AiTask } from "@/lib/client/ai/providers";
import type { AiSettings } from "@/lib/client/ai/settings";
import { estimateCost } from "./cost";
import { ModelPickerDialog, TASK_COPY, type ModelChoice } from "./ModelPickerDialog";
import { optionKey } from "./model-search";
import { useConnectedModels } from "./use-connected-models";

type Props = {
  task: AiTask;
  settings: AiSettings;
  onChange: (choice: ModelChoice | null) => void;
};

/** Resumo da tarefa (modelo atual e custo) com o botão que abre o `ModelPickerDialog`. */
export function TaskModelRow({ task, settings, onChange }: Props) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const copy = TASK_COPY[task];
  const choice = settings.tasks[task];
  const hasConnected = PROVIDER_IDS.some((id) => isConnected(settings, id));
  const active = choice && isConnected(settings, choice.provider) ? choice : null;
  // Escolha salva cujo provedor foi desconectado: `resolveTaskModel` falha com `no_provider`, não cai no automático.
  const stale = choice && !active ? choice : null;
  // Só lê o cache (sem buscar): a lista é baixada quando o modal abre pela primeira vez.
  const { options } = useConnectedModels(settings, false);
  const current = active ? options.find((o) => optionKey(o) === `${active.provider}:${active.model}`) : undefined;
  const cost = estimateCost(task, current);
  const isFree = active?.provider === "openrouter" && isFreeModel(active.model);

  return (
    <div role="group" aria-labelledby={titleId} className="flex flex-col gap-3 border-t border-jf-chip pt-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-[200px] flex-[1_1_240px]">
          <p id={titleId} className="font-semibold">
            {copy.name}
          </p>
          <p className="mt-0.5 text-[13px] text-jf-ink-3">{copy.desc}</p>
        </div>
        <div className="min-w-0 flex-[1_1_220px]">
          <p className="truncate text-[15px] text-jf-ink">
            {active ? `${current?.label ?? active.model} · ${PROVIDERS[active.provider].label}` : stale
              ? `${stale.model} · ${PROVIDERS[stale.provider].label} (não conectado)`
              : "Automático"}
          </p>
          {cost !== undefined && <p className="mt-0.5 text-[13px] text-jf-ink-3">{cost}</p>}
        </div>
        <div className="flex flex-none flex-wrap gap-2">
          {/* Sem isto, uma escolha com provedor desconectado e nenhum outro conectado não tem como voltar ao automático. */}
          {stale && (
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => onChange(null)}>
              Usar automático
            </Button>
          )}
          <Button type="button" variant="outline" className="min-h-11" disabled={!hasConnected} onClick={() => setOpen(true)}>
            Trocar modelo
          </Button>
        </div>
      </div>
      {stale && (
        <p role="alert" className="text-[13px] text-jf-danger-fg">
          Provedor escolhido não está conectado. Conecte {PROVIDERS[stale.provider].label} ou escolha outro provedor, ou
          volte para o automático; enquanto isso, esta tarefa não roda.
        </p>
      )}
      {isFree && (
        <p role="note" className="rounded-lg bg-jf-new-bg px-2.5 py-2 text-[13px] text-jf-new-fg">
          Modelos gratuitos têm limite de uso por dia e quem os oferece pode guardar, usar para treino ou publicar o
          que você envia. E-mail, telefone, endereço e nome nunca são enviados.
        </p>
      )}
      <ModelPickerDialog task={task} settings={settings} open={open} onOpenChange={setOpen} onSelect={onChange} />
    </div>
  );
}
