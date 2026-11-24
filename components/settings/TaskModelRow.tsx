"use client";

import { useQuery } from "@tanstack/react-query";
import { useId, useMemo } from "react";
import { isConnected } from "@/lib/client/ai/model";
import { isFreeModel, PROVIDER_IDS, PROVIDERS, type AiTask, type ModelInfo, type ProviderId } from "@/lib/client/ai/providers";
import type { AiSettings } from "@/lib/client/ai/settings";
import { Combobox, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxPopup, ComboboxTrigger } from "@/components/ui/combobox";
import { estimateCost, priceLabel, sortModelsByCost } from "./cost";

export const TASK_COPY: Record<AiTask, { name: string; desc: string }> = {
  extract: { name: "Ler currículo", desc: "Transforma seu PDF em perfil estruturado." },
  analyze: { name: "Analisar vaga", desc: "Pontos fortes, lacunas e nota revisada." },
  cv: { name: "Gerar CV e carta", desc: "Texto final, revisado por você antes do PDF." },
};

const SELECT =
  "min-h-11 rounded-lg border border-jf-line-strong bg-jf-surface px-2.5 text-[15px] font-normal text-jf-ink outline-none focus-visible:ring-2 focus-visible:ring-jf-brand disabled:opacity-60";

const STALE = "__stale";

/** Minúsculas e sem acento: "Gêmini" vira "gemini". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Busca no nome e no id do modelo, ignorando caixa e acento. */
function matchesModel(model: ModelInfo, query: string): boolean {
  return fold(`${model.label} ${model.id}`).includes(fold(query.trim()));
}

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
  // Escolha salva cujo provedor foi desconectado: `resolveTaskModel` falha com `no_provider`, não cai no automático.
  const stale = choice && !active ? choice : null;
  const models = useModels(active?.provider, settings);

  const def = active ? PROVIDERS[active.provider] : null;
  const recommended = def?.defaultModels[task];
  const activeModel = active?.model;
  // Identidade estável entre renders: o Base UI ressincroniza o input com o label quando o valor muda de
  // referência, e um `{ id, label }` recriado a cada render apagaria o que o usuário está digitando.
  const { items, current } = useMemo(() => {
    const list: ModelInfo[] = [...(models.data ?? [])];
    for (const id of [activeModel, recommended]) {
      if (id && !list.some((m) => m.id === id)) list.unshift({ id, label: id });
    }
    return {
      items: sortModelsByCost(task, list),
      current: activeModel === undefined ? undefined : list.find((m) => m.id === activeModel),
    };
  }, [models.data, activeModel, recommended, task]);
  const isFree = active?.provider === "openrouter" && isFreeModel(active.model);

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
            value={active?.provider ?? (stale ? STALE : "")}
            onChange={(e) => {
              const next = e.target.value as ProviderId | "";
              if ((e.target.value as string) === STALE) return;
              onChange(next === "" ? null : { provider: next, model: PROVIDERS[next].defaultModels[task] });
            }}
          >
            <option value="">Automático (primeiro provedor conectado)</option>
            {stale && (
              <option value={STALE} disabled>
                {PROVIDERS[stale.provider].label} (não conectado)
              </option>
            )}
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
          <Combobox<ModelInfo>
            items={items}
            value={current ?? null}
            disabled={!active}
            filter={matchesModel}
            itemToStringLabel={(m) => m.label}
            isItemEqualToValue={(a, b) => a.id === b.id}
            onValueChange={(m) => {
              if (active && m) onChange({ provider: active.provider, model: m.id });
            }}
          >
            <div className="relative">
              <ComboboxInput id={modelId} placeholder={active ? "Buscar modelo" : "Modelo padrão do provedor"} />
              <ComboboxTrigger aria-label="Abrir lista de modelos" />
            </div>
            <ComboboxPopup>
              <ComboboxEmpty>Nenhum modelo encontrado</ComboboxEmpty>
              <ComboboxList>
                {(m: ModelInfo) => (
                  <ComboboxItem key={m.id} value={m}>
                    <span className="min-w-0 flex-1 truncate" title={m.id}>
                      {m.label}
                      {m.id === recommended && <span className="text-jf-ink-3"> (recomendado)</span>}
                    </span>
                    <span className="flex-none text-[13px] text-jf-ink-3">{priceLabel(task, m)}</span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxPopup>
          </Combobox>
        </div>
        <span className="flex min-h-11 flex-none items-center text-[13px] text-jf-ink-3">
          {active ? (models.isPending ? "Carregando preços…" : estimateCost(task, current)) : "custo depende do modelo"}
        </span>
      </div>
      {stale && (
        <p role="alert" className="text-[13px] text-jf-danger-fg">
          Provedor escolhido não está conectado. Conecte {PROVIDERS[stale.provider].label} ou escolha outro provedor, ou
          volte para o automático; enquanto isso, esta tarefa não roda.
        </p>
      )}
      {active && models.isError && (
        <p className="text-[13px] text-jf-ink-3">
          Não foi possível carregar a lista de modelos agora. Você ainda pode usar o modelo recomendado.
        </p>
      )}
      {isFree && (
        <p role="note" className="rounded-lg bg-jf-new-bg px-2.5 py-2 text-[13px] text-jf-new-fg">
          Modelos gratuitos têm limite de uso por dia e quem os oferece pode guardar, usar para treino ou publicar o
          que você envia. E-mail, telefone, endereço e nome nunca são enviados.
        </p>
      )}
    </div>
  );
}
