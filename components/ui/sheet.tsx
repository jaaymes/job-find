"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"
import { cn } from "@/lib/utils"

function Sheet({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />
}

const SIDE_CLASSES = {
  bottom:
    "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-[20px] pb-[env(safe-area-inset-bottom)] data-open:slide-in-from-bottom data-closed:slide-out-to-bottom",
  full: "inset-0 h-dvh data-open:slide-in-from-bottom data-closed:slide-out-to-bottom",
} as const

function SheetContent({
  title,
  description,
  side = "bottom",
  footer,
  children,
  className,
}: {
  title: string
  description?: string
  side?: "bottom" | "full"
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <DialogPrimitive.Portal data-slot="sheet-portal">
      <DialogPrimitive.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 isolate z-50 bg-black/45 duration-200 motion-reduce:transition-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none"
      />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed z-50 flex flex-col bg-popover text-sm text-popover-foreground shadow-[0_-8px_24px_rgba(21,23,28,.12)] outline-none duration-200 motion-reduce:transition-none data-open:animate-in data-closed:animate-out motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none",
          SIDE_CLASSES[side],
          className
        )}
      >
        {side === "bottom" && (
          <div aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border" />
        )}
        <div className="flex shrink-0 items-start justify-between gap-2 px-4 pt-3 pb-2">
          <div className="flex min-w-0 flex-col gap-1">
            <DialogPrimitive.Title className="text-base leading-tight font-semibold">
              {title}
            </DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="text-sm text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            data-slot="sheet-close"
            className="-mt-1 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <XIcon className="size-5" />
            <span className="sr-only">Fechar</span>
          </DialogPrimitive.Close>
        </div>
        <div data-sheet-body className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {children}
        </div>
        {footer && (
          <div data-slot="sheet-footer" className="shrink-0 border-t bg-popover p-4">
            {footer}
          </div>
        )}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

export { Sheet, SheetClose, SheetContent, SheetTrigger }
