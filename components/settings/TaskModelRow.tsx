"use client";

import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { isConnected } from "@/lib/client/ai/model";
import { PROVIDER_IDS, PROVIDERS, type AiTask, type ModelInfo, type ProviderId } from "@/lib/client/ai/providers";
import type { AiSettings } from "@/lib/client/ai/settings";
import { estimateCost } from "./cost";

export const TASK_COPY: Record<AiTask, { name: string; desc: string }> = {
  extract: { name: "Ler currículo", desc: "Transforma seu PDF em perfil estruturado." },
  analyze: { name: "Analisar vaga", desc: "Pontos fortes, lacunas e nota revisada." },
  cv: { name: "Gerar CV e carta", desc: "Texto final, revisado por você antes do PDF." },
};

const SELECT =
  "min-h-11 rounded-lg border border-jf-line-strong bg-jf-surface px-2.5 text-[15px] font-normal text-jf-ink outline-none focus-visible:ring-2 focus-visible:ring-jf-brand disabled:opacity-60";

type Props = {
  task: AiTask;
  settings: AiSettings;
  onChange: (choice: { provider: ProviderId; model: string } | null) => void;
};

/** Modelos do provedor escolhido; a chave não entra na queryKey (o `addedAt` invalida ao trocar de chave). */
function useModels(id: ProviderId | undefined, settings: AiSettings) {
  const cfg = id ? settings.providers[id] : undefined;
  return useQuery({
    queryKey: ["ai-models", id, cfg?.addedAt],
    queryFn: () => PROVIDERS[id as ProviderId].listModels({ apiKey: cfg?.key, baseURL: cfg?.baseURL }),
    enabled: id !== undefined && cfg !== undefined,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function TaskModelRow({ task, settings, onChange }: Props) {
  const titleId = useId();
  const providerId = useId();
  const modelId = useId();
  const copy = TASK_COPY[task];
  const choice = settings.tasks[task];
  const connected = PROVIDER_IDS.filter((id) => isConnected(settings, id));
  const active = choice && connected.includes(choice.provider) ? choice : null;
  const models = useModels(active?.provider, settings);

  const def = active ? PROVIDERS[active.provider] : null;
  const recommended = def?.defaultModels[task];
  const list: ModelInfo[] = [...(models.data ?? [])];
  for (const id of [active?.model, recommended]) {
    if (id && !list.some((m) => m.id === id)) list.unshift({ id, label: id });
  }
  const current = active ? list.find((m) => m.id === active.model) : undefined;
  const isFree = active?.provider === "openrouter" && active.model.endsWith(":free");

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className="flex flex-col gap-3 border-t border-jf-chip pt-3.5"
    >
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-[200px] flex-[1_1_240px]">
          <p id={titleId} className="font-semibold">
            {copy.name}
          </p>
          <p className="mt-0.5 text-[13px] text-jf-ink-3">{copy.desc}</p>
        </div>
        <div className="flex flex-[1_1_200px] flex-col gap-1.5">
          <label htmlFor={providerId} className="text-[13px] font-semibold text-jf-ink-2">
            Provedor
          </label>
          <select
            id={providerId}
            className={SELECT}
            value={active?.provider ?? ""}
            onChange={(e) => {
              const next = e.target.value as ProviderId | "";
              onChange(next === "" ? null : { provider: next, model: PROVIDERS[next].defaultModels[task] });
            }}
          >
            <option value="">Automático (primeiro provedor conectado)</option>
            {connected.map((id) => (
              <option key={id} value={id}>
                {PROVIDERS[id].label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-[1_1_260px] flex-col gap-1.5">
          <label htmlFor={modelId} className="text-[13px] font-semibold text-jf-ink-2">
            Modelo
          </label>
          <select
            id={modelId}
            className={SELECT}
            disabled={!active}
            value={active?.model ?? ""}
            onChange={(e) => active && onChange({ provider: active.provider, model: e.target.value })}
          >
            {!active && <option value="">Modelo padrão do provedor</option>}
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === recommended ? `${m.label} (recomendado)` : m.label}
              </option>
            ))}
          </select>
        </div>
        <span className="flex min-h-11 flex-none items-center text-[13px] text-jf-ink-3">
          {active ? (models.isPending ? "Carregando preços…" : estimateCost(task, current)) : "custo depende do modelo"}
        </span>
      </div>
      {active && models.isError && (
        <p className="text-[13px] text-jf-ink-3">
          Não foi possível carregar a lista de modelos agora. Você ainda pode usar o modelo recomendado.
        </p>
      )}
      {isFree && (
        <p role="note" className="rounded-lg bg-jf-new-bg px-2.5 py-2 text-[13px] text-jf-new-fg">
          Modelos gratuitos (:free) do OpenRouter costumam registrar e reutilizar os dados enviados, além de terem
          limites de uso. Evite enviar o currículo completo com eles.
        </p>
      )}
    </div>
  );
}
