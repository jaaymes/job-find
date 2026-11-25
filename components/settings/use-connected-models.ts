"use client";

import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import { isConnected } from "@/lib/client/ai/model";
import {
  PROVIDER_IDS,
  PROVIDERS,
  type ModelInfo,
  type ProviderId,
} from "@/lib/client/ai/providers";
import type { AiSettings } from "@/lib/client/ai/settings";
import type { ModelOption } from "./model-search";

export type ConnectedModelsState = {
  provider: ProviderId;
  status: "pending" | "error" | "success";
  refetch: () => void;
};

/**
 * Modelos de todos os provedores conectados, uma consulta por provedor (um erro não derruba os outros).
 * A chave não entra na queryKey: o `addedAt` invalida a lista ao trocar de chave.
 */
type Slice = {
  data: ModelInfo[] | undefined;
  status: ConnectedModelsState["status"];
  refetch: () => void;
};

/**
 * Função de módulo (identidade fixa): o TanStack compartilha a estrutura do resultado, então só muda se `data`/`status`
 * mudarem. O `refetch` vai direto, sem embrulho: o `QueryObserver` já o deixa com identidade estável.
 */
function combine(results: UseQueryResult<ModelInfo[]>[]): Slice[] {
  return results.map((r) => ({
    data: r.data,
    status: r.status,
    refetch: r.refetch,
  }));
}

/**
 * `enabled`: `true` busca todos os conectados; uma lista busca só esses provedores (os outros só leem o cache).
 */
export function useConnectedModels(
  settings: AiSettings,
  enabled: boolean | readonly ProviderId[],
): { options: ModelOption[]; states: ConnectedModelsState[] } {
  const connected = PROVIDER_IDS.filter((id) => isConnected(settings, id));
  const connectedKey = connected.join(",");
  const tasksKey = JSON.stringify(settings.tasks);

  const slices = useQueries({
    queries: connected.map((id) => {
      const cfg = settings.providers[id];
      return {
        queryKey: ["ai-models", id, cfg?.addedAt],
        queryFn: () =>
          PROVIDERS[id].listModels({ apiKey: cfg?.key, baseURL: cfg?.baseURL }),
        enabled: typeof enabled === "boolean" ? enabled : enabled.includes(id),
        staleTime: 30 * 60_000,
        retry: false,
      };
    }),
    combine,
  });

  // Identidade estável entre renders (o Base UI ressincroniza o input quando o valor muda de referência).
  // O React Compiler só roda como lint aqui, então a memoização é manual; as entradas são `slices` (compartilhado
  // pelo TanStack), os provedores conectados e as escolhas salvas, por valor.
  const options = useMemo(() => {
    const ids =
      connectedKey === "" ? [] : (connectedKey.split(",") as ProviderId[]);
    const tasks = JSON.parse(tasksKey) as AiSettings["tasks"];
    const out: ModelOption[] = [];
    ids.forEach((provider, i) => {
      const list: ModelOption[] = (slices[i]?.data ?? []).map((m) => ({
        ...m,
        provider,
      }));
      const wanted = [
        ...Object.values(tasks).flatMap((t) =>
          t && t.provider === provider ? [t.model] : [],
        ),
        ...Object.values(PROVIDERS[provider].defaultModels),
      ];
      for (const id of wanted) {
        if (!list.some((m) => m.id === id))
          list.push({ id, label: id, provider });
      }
      out.push(...list);
    });
    return out;
  }, [slices, connectedKey, tasksKey]);

  const states = useMemo<ConnectedModelsState[]>(() => {
    const ids =
      connectedKey === "" ? [] : (connectedKey.split(",") as ProviderId[]);
    return ids.map((provider, i) => ({
      provider,
      status: slices[i]?.status ?? "pending",
      refetch: slices[i]?.refetch ?? (() => {}),
    }));
  }, [slices, connectedKey]);

  return { options, states };
}
