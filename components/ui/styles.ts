import { buttonVariants } from "@/components/ui/button";

export const FIELD_LABEL = "flex flex-col gap-1.5 text-[13px] font-semibold text-jf-ink-2";
export const FIELD =
  "min-h-11 w-full rounded-lg border border-jf-field-border bg-jf-surface px-3 py-2 text-base font-normal md:text-[15px] text-jf-ink outline-none focus-visible:ring-2 focus-visible:ring-jf-brand disabled:opacity-60";
export const CARD = "rounded-2xl border border-jf-line bg-jf-surface";
export const BTN_OUTLINE = buttonVariants({ variant: "outline" });
export const BTN_PRIMARY = buttonVariants({ variant: "primary" });
