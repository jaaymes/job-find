"use client";

import { memo, useDeferredValue, useId, useMemo, useRef, useState, type RefObject } from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { isFreeModel, PROVIDERS, type AiTask, type ProviderId } from "@/lib/client/ai/providers";
import type { AiSettings } from "@/lib/client/ai/settings";
import { foldQuery, matchesSearchText, optionKey, searchText, type ModelOption } from "./model-search";
import { useConnectedModels, type ConnectedModelsState } from "./use-connected-models";
import { operationCost, priceLabel, sortModelsByCost } from "./cost";

export const TASK_COPY: Record<AiTask, { name: string; desc: string }> = {
  extract: { name: "Ler currículo", desc: "Transforma seu PDF em perfil estruturado." },
  analyze: { name: "Analisar vaga", desc: "Pontos fortes, lacunas e nota revisada." },
  cv: { name: "Gerar CV e carta", desc: "Texto final, revisado por você antes do PDF." },
};

export type ModelChoice = { provider: ProviderId; model: string };

type Props = {
  task: AiTask;
  settings: AiSettings;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (choice: ModelChoice | null) => void;
};

/** Opção fixa do topo: grava `null` (primeiro provedor conectado, modelo recomendado). */
const AUTO = "__auto" as const;
type PickerItem = ModelOption | typeof AUTO;

/**
 * Grátis pelo preço ou, com o cache frio (sem preço ainda), pelo id: `:free` e o roteador grátis do OpenRouter. Cobre
 * também o modelo salvo grátis, que entra na lista sem preço antes de o `/models` responder.
 */
function isFreeOption(task: AiTask, o: ModelOption): boolean {
  return operationCost(task, o) === 0 || (o.provider === "openrouter" && isFreeModel(o.id));
}

const itemKey = (item: PickerItem) => (item === AUTO ? AUTO : optionKey(item));
const itemLabel = (item: PickerItem) => (item === AUTO ? "Automático" : item.label);
const sameItem = (a: PickerItem, b: PickerItem) => itemKey(a) === itemKey(b);

const CHIP =
  "min-h-11 rounded-full border border-jf-line-strong bg-jf-surface px-3.5 text-[14px] font-medium text-jf-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-jf-brand aria-pressed:border-jf-brand aria-pressed:bg-jf-brand-soft aria-pressed:text-jf-brand-dark";
const BADGE = "rounded-full px-2 py-0.5 text-[11px] font-semibold";
const ROW =
  "flex w-full cursor-default items-start gap-3 rounded-md px-2.5 py-2 text-[14px] outline-none select-none data-highlighted:bg-jf-chip [content-visibility:auto] [contain-intrinsic-size:auto_3.5rem]";

/**
 * Escolha do modelo de uma tarefa: busca, filtros e a lista de todos os provedores conectados, do mais barato ao mais
 * caro. Usa o `Combobox` do Base UI no modo `inline` (lista sempre aberta, sem popup/portal) para o teclado.
 */
export function ModelPickerDialog({ task, settings, open, onOpenChange, onSelect }: Props) {
  // As consultas só começam na primeira abertura (a resposta do OpenRouter é grande) e ficam no cache depois.
  const [everOpened, setEverOpened] = useState(open);
  // Cada abertura ganha um corpo novo (`key`): busca, filtros e o "Só gratuitos" inicial recomeçam do zero.
  // O corpo continua montado ao fechar, para não sumir antes do fim da animação.
  const [session, setSession] = useState(open ? 1 : 0);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setEverOpened(true);
      setSession((n) => n + 1);
    }
  }
  const { options, states } = useConnectedModels(settings, everOpened);
  const copy = TASK_COPY[task];
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent initialFocus={inputRef} className="flex flex-col gap-3 sm:max-h-[min(90dvh,44rem)] sm:max-w-xl">
        <DialogHeader className="pr-8">
          <DialogTitle>Modelo para {copy.name}</DialogTitle>
          <DialogDescription>{copy.desc}</DialogDescription>
        </DialogHeader>
        {everOpened && (
          <PickerBody
            key={session}
            task={task}
            settings={settings}
            options={options}
            states={states}
            inputRef={inputRef}
            onCancel={() => onOpenChange(false)}
            onPick={(choice) => {
              onSelect(choice);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

type BodyProps = {
  task: AiTask;
  settings: AiSettings;
  options: ModelOption[];
  states: ConnectedModelsState[];
  inputRef: RefObject<HTMLInputElement | null>;
  onCancel: () => void;
  onPick: (choice: ModelChoice | null) => void;
};

function countText(n: number): string {
  if (n === 0) return "Nenhum modelo encontrado";
  return n === 1 ? "1 modelo" : `${n} modelos`;
}

/** Montado de novo a cada abertura (`key`): busca e filtros recomeçam do zero. */
function PickerBody({ task, settings, options, states, inputRef, onCancel, onPick }: BodyProps) {
  const searchId = useId();
  const saved = settings.tasks[task];
  const savedKey = saved ? `${saved.provider}:${saved.model}` : null;

  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [providerFilter, setProviderFilter] = useState<ProviderId | null>(null);
  // "Só gratuitos" já vem ligado quando o modelo atual é grátis.
  // Com o cache frio o modelo salvo ainda não tem preço, então o id `:free`/roteador grátis do OpenRouter também conta.
  const [freeOnly, setFreeOnly] = useState(() => {
    if (!saved) return false;
    if (saved.provider === "openrouter" && isFreeModel(saved.model)) return true;
    const current = options.find((o) => optionKey(o) === savedKey);
    return current !== undefined && operationCost(task, current) === 0;
  });

  const sorted = useMemo(() => sortModelsByCost(task, options), [task, options]);
  // Texto de busca dobrado uma vez por lista (não a cada tecla), indexado pela própria opção.
  const index = useMemo(
    () => new Map(options.map((o) => [o, searchText(o, PROVIDERS[o.provider].label)] as const)),
    [options],
  );
  const counts = useMemo(() => {
    const out = new Map<ProviderId, number>();
    for (const o of options) out.set(o.provider, (out.get(o.provider) ?? 0) + 1);
    return out;
  }, [options]);
  const visible = useMemo(() => {
    const q = foldQuery(deferredQuery);
    return sorted.filter(
      (o) =>
        (providerFilter === null || o.provider === providerFilter) &&
        (!freeOnly || isFreeOption(task, o)) &&
        matchesSearchText(index.get(o) ?? "", q),
    );
  }, [sorted, providerFilter, freeOnly, task, deferredQuery, index]);
  // Identidades estáveis: o Base UI recalcula a navegação quando a referência da lista muda.
  const items = useMemo<PickerItem[]>(() => [AUTO, ...sorted], [sorted]);
  const filteredItems = useMemo<PickerItem[]>(() => [AUTO, ...visible], [visible]);
  const loading = states.some((s) => s.status === "pending");
  const failed = states.filter((s) => s.status === "error");

  return (
    <>
      <ComboboxPrimitive.Root<PickerItem>
        inline
        open
        items={items}
        filteredItems={filteredItems}
        value={null}
        inputValue={query}
        onInputValueChange={(value) => setQuery(value)}
        itemToStringLabel={itemLabel}
        isItemEqualToValue={sameItem}
        onValueChange={(item) => {
          if (item === null) return;
          onPick(item === AUTO ? null : { provider: item.provider, model: item.id });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={searchId} className="text-[13px] font-semibold text-jf-ink-2">
            Buscar modelo
          </label>
          <ComboboxPrimitive.Input
            id={searchId}
            ref={inputRef}
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="Nome, provedor ou id"
            className="min-h-11 w-full min-w-0 rounded-lg border border-jf-line-strong bg-jf-surface px-2.5 text-base text-jf-ink outline-none md:text-[15px] placeholder:text-jf-ink-3 focus-visible:ring-2 focus-visible:ring-jf-brand"
          />
        </div>
        <div role="group" aria-label="Filtros" className="flex flex-wrap gap-2">
          <button type="button" className={CHIP} aria-pressed={providerFilter === null} onClick={() => setProviderFilter(null)}>
            Todos
          </button>
          {states.map(({ provider, status }) => (
            <button
              key={provider}
              type="button"
              className={CHIP}
              aria-pressed={providerFilter === provider}
              onClick={() => setProviderFilter(provider)}
            >
              {PROVIDERS[provider].label}
              {/* Sem a lista (carregando ou com erro), a contagem seria só dos modelos injetados: enganaria. */}
              {status === "success" && ` (${counts.get(provider) ?? 0})`}
            </button>
          ))}
          <button type="button" className={CHIP} aria-pressed={freeOnly} onClick={() => setFreeOnly((v) => !v)}>
            Só gratuitos
          </button>
        </div>
        {/* Região viva sempre no DOM (anuncia o que entra nela) e só com textos; os botões ficam fora, como irmãos. */}
        <div aria-live="polite" className="flex min-h-0 flex-col gap-1">
          {states.map((s) =>
            s.status === "pending" ? (
              <p key={s.provider} className="text-[13px] text-jf-ink-3">
                Carregando modelos de {PROVIDERS[s.provider].label}…
              </p>
            ) : s.status === "error" ? (
              <p key={s.provider} className="text-[13px] text-jf-danger-fg">
                Não foi possível carregar os modelos de {PROVIDERS[s.provider].label}.
              </p>
            ) : null,
          )}
        </div>
        {failed.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {failed.map((s) => (
              <Button key={s.provider} type="button" variant="outline" className="min-h-11" onClick={() => s.refetch()}>
                Tentar de novo
                {failed.length > 1 && <span className="sr-only"> ({PROVIDERS[s.provider].label})</span>}
              </Button>
            ))}
          </div>
        )}
        <p role="status" className="sr-only">
          {loading && visible.length === 0 ? "" : countText(visible.length)}
        </p>
        <ComboboxPrimitive.List
          aria-label="Modelos"
          className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-1 outline-none"
        >
          {(item: PickerItem) =>
            item === AUTO ? (
              <ComboboxPrimitive.Item key={AUTO} value={AUTO} className={ROW}>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">Automático (primeiro provedor conectado, modelo recomendado)</span>
                    {saved === null && <span className={cn(BADGE, "bg-jf-chip text-jf-ink-2")}>Atual</span>}
                  </span>
                </span>
              </ComboboxPrimitive.Item>
            ) : (
              <ModelRow key={optionKey(item)} task={task} item={item} current={optionKey(item) === savedKey} />
            )
          }
        </ComboboxPrimitive.List>
        {visible.length === 0 && !loading && (
          <p className="px-2.5 py-2 text-[14px] text-jf-ink-3">Nenhum modelo encontrado</p>
        )}
      </ComboboxPrimitive.Root>
      <DialogFooter>
        <Button type="button" variant="outline" className="min-h-11" onClick={onCancel}>
          Cancelar
        </Button>
      </DialogFooter>
    </>
  );
}

/** `memo`: com 380 linhas, só re-renderiza a linha cujas props mudaram (item e task estáveis, `current` booleano). */
const ModelRow = memo(function ModelRow({ task, item, current }: { task: AiTask; item: ModelOption; current: boolean }) {
  const recommended = item.id === PROVIDERS[item.provider].defaultModels[task];
  const free = isFreeOption(task, item);
  // Com o selo "Grátis", o preço "grátis" repetiria a mesma informação.
  const price = free ? "" : priceLabel(task, item);
  return (
    <ComboboxPrimitive.Item value={item} className={ROW}>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-medium break-words">{item.label}</span>
          {current && <span className={cn(BADGE, "bg-jf-chip text-jf-ink-2")}>Atual</span>}
          {recommended && <span className={cn(BADGE, "bg-jf-brand-soft text-jf-brand-dark")}>Recomendado</span>}
          {free && <span className={cn(BADGE, "bg-jf-new-bg text-jf-new-fg")}>Grátis</span>}
        </span>
        <span className="block truncate text-[13px] text-jf-ink-3">
          {PROVIDERS[item.provider].label}
          {item.label !== item.id && <> · {item.id}</>}
        </span>
      </span>
      {price !== "" && <span className="flex-none pt-0.5 text-[13px] text-jf-ink-3">{price}</span>}
    </ComboboxPrimitive.Item>
  );
});
