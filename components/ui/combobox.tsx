"use client"

import * as React from "react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { cn } from "@/lib/utils"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

const Combobox = ComboboxPrimitive.Root

function ComboboxInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-input"
      className={cn(
        "min-h-11 w-full min-w-0 rounded-lg border border-jf-line-strong bg-jf-surface py-2 pr-10 pl-2.5 text-[15px] font-normal text-jf-ink outline-none placeholder:text-jf-ink-3 focus-visible:ring-2 focus-visible:ring-jf-brand disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      {...props}
    />
  )
}

function ComboboxTrigger({ className, children, ...props }: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      className={cn(
        "absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-jf-ink-3 outline-none focus-visible:ring-2 focus-visible:ring-jf-brand disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {children ?? <ChevronDownIcon aria-hidden="true" />}
    </ComboboxPrimitive.Trigger>
  )
}

function ComboboxPopup({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<ComboboxPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className="isolate z-50"
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-popup"
          className={cn(
            "max-h-[min(var(--available-height),22rem)] w-(--anchor-width) min-w-60 origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-lg border border-jf-line-strong bg-jf-surface p-1 text-jf-ink shadow-md",
            className
          )}
          {...props}
        >
          {children}
        </ComboboxPrimitive.Popup>
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  )
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      className={cn("flex flex-col gap-0.5 outline-none", className)}
      {...props}
    />
  )
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-md py-2 pr-2 pl-7 text-[14px] outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-jf-chip",
        className
      )}
      {...props}
    >
      <ComboboxPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center text-jf-brand" />
        }
      >
        <CheckIcon className="size-4" aria-hidden="true" />
      </ComboboxPrimitive.ItemIndicator>
      {children}
    </ComboboxPrimitive.Item>
  )
}

function ComboboxEmpty({ className, ...props }: ComboboxPrimitive.Empty.Props) {
  return (
    <ComboboxPrimitive.Empty
      data-slot="combobox-empty"
      className={cn("px-2.5 text-[14px] text-jf-ink-3 empty:m-0 empty:p-0 not-empty:py-2", className)}
      {...props}
    />
  )
}

export { Combobox, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxPopup, ComboboxTrigger }
