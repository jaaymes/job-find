"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronRight, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { JOB_STATUSES, STATUS_LABELS, type JobStatus } from "@/lib/client/jobs/job-state";
import { cn } from "@/lib/utils";

const POPUP =
  "z-50 min-w-48 rounded-xl border border-jf-line bg-jf-surface p-1 text-jf-ink shadow-lg outline-none";
const ITEM =
  "flex min-h-11 cursor-default items-center gap-2 rounded-lg px-3 text-sm outline-none select-none data-[highlighted]:bg-jf-chip sm:min-h-10";

/** Menu "⋯" do card: Mudar status (submenu), Ocultar vaga e Copiar link. */
export function JobCardMenu({
  jobId,
  title,
  jobUrl,
  status,
  hidden = false,
  onHide,
  onStatusChange,
  className,
}: {
  jobId: number;
  /** Título da vaga, para o nome acessível do botão. */
  title?: string;
  /** Caminho (`/vagas/12`) ou URL completa; o caminho vira absoluto na hora de copiar. */
  jobUrl: string;
  status: JobStatus | null;
  /** Vaga já oculta: o item vira "Mostrar de novo" e `onHide` desfaz. */
  hidden?: boolean;
  onHide: () => void;
  onStatusChange?: (status: JobStatus) => void;
  className?: string;
}) {
  const copyLink = async () => {
    const url = jobUrl.startsWith("/") ? `${window.location.origin}${jobUrl}` : jobUrl;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copiado");
    } catch {
      toast("Não foi possível copiar o link");
    }
  };

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={title ? `Mais ações: ${title}` : `Mais ações da vaga ${jobId}`}
        className={cn(
          "relative z-10 inline-flex size-11 items-center justify-center rounded-lg text-jf-ink-2 outline-none hover:bg-jf-chip focus-visible:ring-2 focus-visible:ring-jf-brand data-[popup-open]:bg-jf-chip sm:size-10",
          className,
        )}
      >
        <MoreHorizontal aria-hidden="true" className="size-5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={4} className="z-50">
          <Menu.Popup className={POPUP}>
            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger className={cn(ITEM, "w-full justify-between data-[popup-open]:bg-jf-chip")}>
                Mudar status
                <ChevronRight aria-hidden="true" className="size-4 text-jf-ink-3" />
              </Menu.SubmenuTrigger>
              <Menu.Portal>
                <Menu.Positioner sideOffset={4} className="z-50">
                  <Menu.Popup className={POPUP}>
                    <Menu.RadioGroup
                      value={status ?? "none"}
                      onValueChange={(v) => onStatusChange?.(v as JobStatus)}
                    >
                      {JOB_STATUSES.map((s) => (
                        <Menu.RadioItem key={s} value={s} closeOnClick className={cn(ITEM, "justify-between")}>
                          {STATUS_LABELS[s]}
                          <Menu.RadioItemIndicator>
                            <Check aria-hidden="true" className="size-4" />
                          </Menu.RadioItemIndicator>
                        </Menu.RadioItem>
                      ))}
                    </Menu.RadioGroup>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.SubmenuRoot>
            <Menu.Item className={ITEM} onClick={onHide}>
              {hidden ? "Mostrar de novo" : "Ocultar vaga"}
            </Menu.Item>
            <Menu.Item className={ITEM} onClick={copyLink}>
              Copiar link
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
